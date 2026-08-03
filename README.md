# Baraat — Event Dispatch System

A mobile-first dispatch system for a private group event (wedding / conference / offsite). It automatically assigns a pre-registered fleet of drivers to guests based on location, timing, vehicle capacity, and live traffic — like a ride-hailing app, but for a fixed, scheduled, multi-stop event where nobody picks their own driver.

> *Baraat* — the groom's procession. Everyone arrives together, nobody gets left behind.

The system has three faces over one backend: an **Admin/Ops portal**, a **Driver portal**, and a **Guest mobile app** — plus an always-on **matching engine** that does the actual assigning.

---

## Table of contents

1. [Architecture](#architecture)
2. [Monorepo layout](#monorepo-layout)
3. [Data model](#data-model)
4. [Prerequisites](#prerequisites)
5. [Environment variables — every key explained](#environment-variables--every-key-explained)
6. [Project setup (step by step)](#project-setup-step-by-step)
7. [Running the apps](#running-the-apps)
8. [The three experiences](#the-three-experiences)
9. [Event lifecycle](#event-lifecycle)
10. [Matching engine (summary)](#matching-engine-summary)
11. [Security model](#security-model)
12. [Testing the API](#testing-the-api)
13. [Deployment shape](#deployment-shape)

---

## Architecture

One brain, three faces, one memory, plus a worker.

```
                       +-------------------------------+
 Guest app (Expo)  --->|                               |
  device keychain,     |   APPLICATION BACKEND         |
  direct HTTPS calls   |   Node + Express + Prisma     |---> Postgres
                       |   auth . RBAC . CRUD .        |     (Supabase or
 Admin + Driver        |   trip flows . engine API     |      any Postgres)
  (web browser)        +-------------------------------+
     |                        ^                ^
     v                        |                | shares packages/db
 +---------------------+      |         +---------------------------+
 | Next.js server      |------+         | DISPATCH WORKER           |
 | THIN: cookie auth,  |                | always-on loop:           |
 | token proxy, role   |                | batch . queue aging .     |
 | gating (Tailwind UI)|                | detours . re-optimization |
 +---------------------+                +---------------------------+
```

**Why this shape:**

- **One backend, one database.** An assignment ("this driver serves this guest, respecting capacity and deadline") must commit atomically over driver state *and* guest state at once. Splitting into multiple services/DBs would turn every assignment into a distributed transaction — the exact failure mode this domain can't afford.
- **Monolith with a worker, not microservices.** The transactional API is serverless-friendly; the matching engine is an always-on loop that needs a persistent host. Same codebase, same Prisma client, **separate process** — so if the engine crashes, in-progress trips (state lives in Postgres) are untouched and the admin's manual-override path keeps working.
- **Thin web server.** Browsers can't store bearer tokens safely, so the portal talks to the API through a thin Next.js server (httpOnly cookie session + a proxy that attaches the token). It holds no business logic and no Prisma — that rule keeps the "one backend" honest.

## Monorepo layout

pnpm workspaces + Turborepo.

```
apps/
  portal      Next.js App Router + Tailwind — Admin/Ops + Driver roles (web)
  guest       React Native (Expo) — guest mobile app
services/
  api         Express + Prisma: auth, RBAC, CRUD, trip flows, admin overrides
  dispatch    always-on matching worker + peak-arrival simulation
packages/
  db          Prisma schema, generated client, RLS SQL, admin seed
  types       shared TS types + engine tuning constants
  maps        maps adapter: Google (Distance Matrix / Directions) or haversine mock
  kv          Redis abstraction with in-memory fallback (queue + cache)
  push        Expo push-notification sender (fire-and-forget)
  config      shared tsconfig / tailwind preset
```

## Data model

A single Postgres schema (Prisma), one source of truth:

- **User** — one row per person; a `role` of `ADMIN | DRIVER | GUEST`. Has a `passwordHash` and optional `expoPushToken`. A `Driver` or `Guest` row hangs off it for the two operational roles.
- **Event** — the thing everyone is scoped to. Exactly one is `ACTIVE`; ended events go `CLOSED` (read-only archive). Carries an optional ride window (`startsAt` / `endsAt`).
- **Driver** — vehicle number, seat/luggage capacity, live position, `status` (`OFFLINE / IDLE / EN_ROUTE_PICKUP / OCCUPIED / ON_BREAK`), and predicted-free time/location the engine uses for planning.
- **Guest** — pickup + optional drop location, group size, luggage, flight/train ETA, scheduled `pickupAt`, `priority` flag, `waitingSince` (the "released to the dispatch queue" marker) and `status` (`WAITING / ASSIGNED / IN_TRANSIT / COMPLETED`).
- **Accommodation** / **EventLocation** — an event's saved places (hotels, and the venue / airport / station / other places), used as pickups, drops, and for clustering.
- **Trip** — a driver serving one or more guests; a status lifecycle (`ASSIGNED → ACCEPTED → ARRIVED_PICKUP → BOARDED → ARRIVED_DROP → COMPLETED`, plus `REJECTED / CANCELLED`), a planned route, ETA, and a hashed 4-digit **boarding OTP**.
- **TripGuest** — join row (a trip can carry several guests; shared rides).
- **RideRequest** — a guest's on-demand ride ask, `PENDING → APPROVED / DECLINED` by ops.
- **RefreshToken** — hashed, rotating refresh tokens for auth.

## Prerequisites

- **Node 22+** and **pnpm 9+** (`corepack enable` gives you pnpm).
- A **Postgres** database — either a free [Supabase](https://supabase.com) project (recommended) or a local Postgres.
- Optional: a Google Maps API key, a Redis instance, and an SMTP account — all have working fallbacks if you skip them.

## Environment variables — every key explained

There are **two** env files:

- **`/.env`** at the repo root — used by the API, the dispatch worker, the portal server, and the database tooling. Copy it from `/.env.example`.
- **`/apps/guest/.env`** — used only by the Expo guest app. Copy it from `/apps/guest/.env.example`.

### Root `.env`

#### Database

| Key | Required | What it is |
|-----|----------|-----------|
| `DATABASE_URL` | ✅ | The connection string the **app** uses at runtime. |
| `DIRECT_URL` | ✅ | A direct (non-pooled) connection string used only for **migrations**. |

**How to get them (Supabase):** create a project, then open **Project Settings → Database → Connection string**.

- `DATABASE_URL` = the **Transaction pooler** string (host looks like `...pooler.supabase.com`, port **6543**). Pooling is what lets many short API calls share a few Postgres connections.
- `DIRECT_URL` = the **Direct connection** string (host looks like `db.<project-ref>.supabase.co`, port **5432**). Prisma needs a direct connection to run migrations.

Replace the `[YOUR-PASSWORD]` placeholder in both with the database password you set when creating the project.

**Local Postgres instead?** Use the same URL for both, e.g. `postgresql://postgres:postgres@localhost:5432/baraat`.

```
DATABASE_URL="postgresql://postgres.<ref>:<password>@aws-1-<region>.pooler.supabase.com:6543/postgres"
DIRECT_URL="postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres"
```

#### Auth

| Key | Required | What it is |
|-----|----------|-----------|
| `JWT_SECRET` | ✅ | Signs short-lived **access** tokens. |
| `JWT_REFRESH_SECRET` | ✅ | Signs long-lived **refresh** tokens. Must differ from `JWT_SECRET`. |
| `ACCESS_TOKEN_TTL` | – | Access token lifetime (default `3d`). |
| `REFRESH_TOKEN_TTL` | – | Refresh token lifetime (default `30d`). |

**How to get them:** generate two different random secrets. On macOS/Linux:

```bash
openssl rand -hex 32   # run twice — once for each secret
```

Any long random string works; never reuse the same value for both.

#### Maps

| Key | Required | What it is |
|-----|----------|-----------|
| `GOOGLE_MAPS_API_KEY` | – | Enables real distances, ETAs, and road polylines. |

**Leave it empty** and the maps adapter uses a deterministic haversine + time-varying-traffic mock — everything (including the simulation) runs with **zero external calls**. To use the real thing: in **Google Cloud Console** create a project, enable the **Distance Matrix**, **Directions**, and **Geocoding** APIs, then create an **API key** under *APIs & Services → Credentials* and paste it here. (Restrict the key to those three APIs.)

#### Redis (optional)

| Key | Required | What it is |
|-----|----------|-----------|
| `REDIS_URL` | – | Backs the priority queue + maps cache. |

**Leave it empty** and the KV layer falls back to in-memory (fine for a single worker; the queue is rebuilt from Postgres every tick, so nothing is lost). For production use [Upstash](https://upstash.com) (free tier) and paste its `redis://...` URL, or `redis://localhost:6379` for a local instance.

#### Services

| Key | Required | What it is |
|-----|----------|-----------|
| `API_PORT` | – | Port the Express API listens on (default `4000`). |
| `DISPATCH_TICK_MS` | – | How often the engine loop runs, in ms (default `5000`). |

#### Portal server

| Key | Required | What it is |
|-----|----------|-----------|
| `BACKEND_URL` | ✅ | Where the portal's server layer reaches the API. `http://localhost:4000` in dev; your deployed API URL in prod. |

#### Email (optional — driver/guest credential emails)

| Key | Required | What it is |
|-----|----------|-----------|
| `SMTP_HOST` | – | SMTP server host, e.g. `smtp.gmail.com`. |
| `SMTP_PORT` | – | SMTP port (default `587`). |
| `SMTP_SECURE` | – | `true` for port 465, otherwise `false`. |
| `SMTP_USER` | – | SMTP username (your email). |
| `SMTP_PASS` | – | SMTP password / app password. |
| `MAIL_FROM` | – | The "From" header, e.g. `Baraat <no-reply@baraat.events>`. |

**When any of host/user/pass is unset, credential emails are logged to the console instead of sent** — so you can develop without an email account. To actually send via **Gmail**: turn on **2-Step Verification** on your Google account, then create an **App Password** (Google Account → Security → 2-Step Verification → App passwords). Use that 16-character value (no spaces) as `SMTP_PASS` — your normal password will not work.

#### Portal link in the driver email

| Key | Required | What it is |
|-----|----------|-----------|
| `PORTAL_URL_DEV` | – | Portal link put in the driver email when `NODE_ENV` ≠ production (default `http://localhost:3000`). |
| `PORTAL_URL_PROD` | – | Portal link used when `NODE_ENV=production`. |

When a driver is registered, their credentials email includes a link to the Ops portal. In development it uses `PORTAL_URL_DEV`; in production it uses `PORTAL_URL_PROD`. Set a single `PORTAL_URL` to override both.

### Guest app `apps/guest/.env`

| Key | Required | What it is |
|-----|----------|-----------|
| `EXPO_PUBLIC_API_URL` | ✅ | The backend URL the phone calls. |

A phone can't reach `localhost` on your computer — it needs your machine's **LAN IP**. Find it with `ipconfig getifaddr en0` (macOS) and set e.g. `EXPO_PUBLIC_API_URL=http://192.168.1.41:4000`. For the iOS Simulator you can use `http://localhost:4000`.

## Project setup (step by step)

```bash
# 1. Install all workspace dependencies
pnpm install

# 2. Create your root env file and fill in the values above
cp .env.example .env

# 3. Generate the Prisma client (engine-less TS client)
pnpm --filter @baraat/db generate

# 4. Apply the database migrations
pnpm --filter @baraat/db migrate:deploy
#    (use `pnpm db:migrate` while developing to create new migrations)

# 5. Apply row-level security policies
pnpm --filter @baraat/db rls:apply

# 6. Seed — creates ONLY the admin account (nothing else)
pnpm db:seed
```

**About `db:seed`:** it wipes the tables and creates a **single admin login** so you can get into the portal — there is no self-signup. It does **not** create any event, drivers, or guests. You start empty and build your event yourself from the portal.

```
admin@baraat.events  /  password123
```

## Running the apps

Three long-running processes, one terminal each:

```bash
pnpm api          # Express API        -> http://localhost:4000
pnpm dispatch     # matching worker    -> logs matches every tick
pnpm portal       # Admin/Driver portal -> http://localhost:3000
```

> The **dispatch worker must be running** for guests to be auto-assigned — the API alone never assigns anyone. If a driver goes online and nothing gets assigned, the worker isn't running (or the event isn't inside its date window, or the driver has no location yet).

Guest app on a physical phone:

```bash
cd apps/guest
cp .env.example .env      # set EXPO_PUBLIC_API_URL to http://<your-LAN-IP>:4000
pnpm start                # scan the QR with Expo Go (same Wi-Fi)
```

If Expo Go complains about an SDK mismatch, run `npx expo install expo@latest && npx expo install --fix` inside `apps/guest`, or use the iOS Simulator (`press i`) with `localhost`.

## The three experiences

**Admin / Ops** (`admin@baraat.events`) — a live dashboard with a fleet map (Leaflet + OpenStreetMap, no key needed), guest/driver/trip management, ride-request approvals with a badge counter, and manual overrides (flag priority, force-assign with a capacity-aware driver picker, cancel/breakdown). It's where you create the event and add drivers and guests. Fully responsive: sidebar on desktop, bottom tabs on phone. Light theme by default with one-tap dark mode remembered per device.

**Driver** (created by the admin) — a mobile-first single-trip screen with one big lifecycle button (Accept → Arrived → enter boarding code → Drop complete), a reject option, tap-to-call the guest, automatic live-location sharing via browser geolocation, an online/offline toggle, and a break state. Drivers sign into the **same portal** with the link from their credentials email.

**Guest** (Expo app) — signs in with the email + default password (`guest123`) the ops team set, and can change it in-app. Four tabs:

- **Ride** — the current/upcoming ride: match card (driver, vehicle, tap-to-call, live ETA), a live map with the driver's marker + route polyline, "Open route in Maps", and a boarding-code generator once the driver arrives.
- **Request** — raise a ride: pickup + drop (current-location or place search), people, luggage. Shows *pending* until ops approve, then a driver is auto-assigned. Blocked while a ride is already in progress or the event is outside its window.
- **History** — past rides for this event.
- **Account** — profile (read-only), change password, sign out.

Push notifications ("You're matched", "Driver on the way", "Driver arrived") are best-effort; polling covers everything even without notification permission.

## Event lifecycle

The admin runs **one event at a time**. Under **Events** in the portal you create an event — its name, an optional **date/time window**, and its saved places (venue, airport, station, accommodations) — then add drivers and guests to it.

- Guests, trips, and places are **scoped to the active event**; the matching engine only ever works within it.
- The **date window blocks all ride activity outside it** — guests can't request, drivers can't accept, the engine won't assign, and you can't even schedule a pickup time outside `[startsAt, endsAt]` — for both admin and guest.
- **Ending an event** moves it to a read-only **Past events** archive (it can't be restarted) and immediately stops new requests and accepts. Starting a new event requires ending the current one first.
- Drivers reused across events only ever see the **current** event's trips; past events live in the admin archive.

## Matching engine (summary)

See [DESIGN.md](./DESIGN.md) for the full write-up. In short:

- **Pre-day batch** clusters same-accommodation guests and solves each round optimally with the **Hungarian algorithm** (`munkres-js`).
- **Real-time greedy** matches on-demand guests in milliseconds by a feasibility filter + score (ETA-to-pickup + how-soon-free), and **splits oversized groups across multiple vehicles**.
- **A no-starvation queue** ages waiting guests so nobody is starved by newer requests.
- **Detour insertion** lets an en-route driver absorb a compatible guest from their live position.
- **Continuous re-optimization** refreshes ETAs and re-queues not-yet-accepted trips whose deadline slips — never reassigning an in-progress trip.
- **Driver breaks** after 4 consecutive trips.
- Everything is **gated to the live event window** — no assignment happens before it starts or after it ends.

## Security model

Two layers:

1. **App-layer RBAC** — JWT with a role claim; `requireRole('ADMIN' | 'DRIVER' | 'GUEST')` on every route. Access tokens are short-lived; refresh tokens rotate (with a small grace window to survive races).
2. **DB-layer RLS** — Postgres row-level security (`packages/db/sql/rls.sql`), `FORCE`d so it applies even to the table owner. Driver- and guest-scoped requests run inside a transaction that sets `app.user_id` / `app.role`, making it *physically impossible* for a driver's query to return another driver's trips or the ops-level view.

Boarding is verified with a **4-digit OTP**: the guest generates it at pickup, the driver must enter it to mark the trip boarded — proof the right guest is in the right car.

## Testing the API

`requests.http` at the repo root (VS Code REST Client / IntelliJ HTTP) walks every endpoint: login for all three roles, admin overview, driver trip transitions, guest on-demand requests, manual overrides, and an RBAC check (a driver hitting an admin route → 403). A Postman collection is under `postman/`.

**Peak-arrival simulation:**

```bash
pnpm simulate
```

It runs the pre-day batch round, fires a burst of on-demand walk-ins (including an oversized group that must be split), and plays every driver through the trip lifecycle against the real engine loop — then prints a report of waits, shared rides, and any capacity/deadline violations. `SIM_SPEEDUP`, `SIM_BURST`, `SIM_STEPS`, `SIM_STEP_MS` control scale and speed.

## Deployment shape

- **Database** — Supabase (or any managed Postgres).
- **API + dispatch worker** — a persistent host (Render / Railway / Fly / an AWS EC2 box with pm2). The worker is a separate always-on process; keep it running alongside the API.
- **Portal** — Vercel (one-click Next.js).
- **Guest app** — Expo EAS build (`eas build -p android --profile preview` for a shareable APK; iOS needs an Apple Developer account and TestFlight/App Store).
- **Redis** — optional (Upstash) if you want the KV layer off in-memory.

The Prisma client is **engine-less** (`engineType = "client"` + node-postgres driver adapter): no Rust binaries to download or ship, identical behavior locally and on Supabase.
