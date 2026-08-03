# Baraat — Event Dispatch System

Baraat is a private ride-dispatch system for a single event — a wedding, a conference, an offsite. You register a fleet of drivers and a list of guests, and the system automatically decides which driver picks up which guest, based on where everyone is, when they need to move, how many seats and bags each car has, and live traffic. Think of it like Uber, but nobody chooses a driver — the system matches everyone for you, for one scheduled multi-stop event. There are three ways to use it: an **Admin/Ops portal** (run the event), a **Driver portal** (drive the trips), and a **Guest mobile app** (get picked up) — all sitting on top of one backend and one always-running matching engine.

> *Baraat* is the groom's procession — everyone arrives together, nobody gets left behind.

---

## Table of contents

1. [Setup](#setup)
2. [Environment files](#environment-files)
3. [Running everything](#running-everything)
4. [How the app is used](#how-the-app-is-used)
5. [Architecture (and why these tech choices)](#architecture-and-why-these-tech-choices)
6. [Trade-offs and limitations](#trade-offs-and-limitations)

---

## Setup

### What you need first

- **Node 22+** and **pnpm 9+** (run `corepack enable` and you get pnpm).
- A **Postgres database** — the easy path is a free [Supabase](https://supabase.com) project. A local Postgres works too.
- Optional extras (all have automatic fallbacks, so you can skip them at first): a Google Maps key, a Redis instance, and an email account.

### Step by step

```bash
# 1. Install everything in the monorepo
pnpm install

# 2. Create your environment files (details in the next section)
cp .env.example .env
cp apps/guest/.env.example apps/guest/.env

# 3. Generate the database client
pnpm --filter @baraat/db generate

# 4. Create the database tables
pnpm --filter @baraat/db migrate:deploy

# 5. Turn on row-level security (keeps drivers/guests from seeing each other's data)
pnpm --filter @baraat/db rls:apply

# 6. Seed — this ONLY creates the admin login, nothing else
pnpm db:seed
```

**About the seed:** it wipes the tables and creates a **single admin account** so you can log into the portal (there is no sign-up page). It does **not** create any event, drivers, or guests — you start with a clean slate and build the event yourself from the portal.

```
Login:  admin@baraat.events
Pass:   password123
```

---

## Environment files

There are **two** environment files in different folders. Each is used by different parts of the app.

### 1. Root `.env` (copy from `.env.example`)

Used by the **API**, the **matching engine**, the **portal server**, and the **database tools**. This is the main one.

**Database** — where all the data lives.

| Key | Needed? | What it's for |
|-----|--------|---------------|
| `DATABASE_URL` | Yes | The connection string the app uses while running. |
| `DIRECT_URL` | Yes | A direct connection used only for running migrations. |

How to get them on Supabase: create a project, then go to **Project Settings → Database → Connection string**.
- `DATABASE_URL` = the **Transaction pooler** string (host ends in `pooler.supabase.com`, port **6543**). Pooling lets lots of small API calls share a few database connections.
- `DIRECT_URL` = the **Direct connection** string (host looks like `db.<your-ref>.supabase.co`, port **5432**). Migrations need a direct connection.
- Put your database password (the one you set when making the project) in place of `[YOUR-PASSWORD]` in both.

Using local Postgres instead? Use the same URL for both, like `postgresql://postgres:postgres@localhost:5432/baraat`.

**Auth** — signs the login tokens.

| Key | Needed? | What it's for |
|-----|--------|---------------|
| `JWT_SECRET` | Yes | Signs short-lived access tokens. |
| `JWT_REFRESH_SECRET` | Yes | Signs long-lived refresh tokens. Must be different from the one above. |
| `ACCESS_TOKEN_TTL` | No | How long an access token lasts (default `3d`). |
| `REFRESH_TOKEN_TTL` | No | How long a refresh token lasts (default `30d`). |

How to get them: generate two different random strings. On Mac/Linux run this **twice** and paste one value into each:
```bash
openssl rand -hex 32
```

**Maps** — real distances and ETAs.

| Key | Needed? | What it's for |
|-----|--------|---------------|
| `GOOGLE_MAPS_API_KEY` | No | Turns on real driving distances, ETAs, and road routes. |

Leave it **empty** and the app uses a built-in offline estimator (straight-line distance with fake but realistic traffic). Everything works with zero external calls. To use the real thing: in **Google Cloud Console**, enable the **Distance Matrix**, **Directions**, and **Geocoding** APIs, then make an API key under *APIs & Services → Credentials*.

**Redis** — optional speed-up for the queue and map cache.

| Key | Needed? | What it's for |
|-----|--------|---------------|
| `REDIS_URL` | No | Backs the waiting-queue and the map cache. |

Leave it **empty** and the app keeps this in memory instead (totally fine for one engine process). For production, [Upstash](https://upstash.com) gives a free Redis URL, or use `redis://localhost:6379`.

**Services** — small knobs.

| Key | Needed? | What it's for |
|-----|--------|---------------|
| `API_PORT` | No | Port the API runs on (default `4000`). |
| `DISPATCH_TICK_MS` | No | How often the engine re-checks and assigns, in milliseconds (default `5000`). |

**Portal server** — how the website reaches the API.

| Key | Needed? | What it's for |
|-----|--------|---------------|
| `BACKEND_URL` | Yes | The API address the portal's server talks to. `http://localhost:4000` in dev; your live API URL in production. |

**Email** — sends drivers/guests their login details. All optional.

| Key | Needed? | What it's for |
|-----|--------|---------------|
| `SMTP_HOST` | No | Mail server, e.g. `smtp.gmail.com`. |
| `SMTP_PORT` | No | Mail port (default `587`). |
| `SMTP_SECURE` | No | `true` for port 465, otherwise `false`. |
| `SMTP_USER` | No | Your email address. |
| `SMTP_PASS` | No | Your app password (see below). |
| `MAIL_FROM` | No | The "from" name, e.g. `Baraat <no-reply@baraat.events>`. |

If host/user/pass are empty, the app just **prints the email to the console** instead of sending it — so you can develop without email set up. To really send through **Gmail**: turn on **2-Step Verification**, then create an **App Password** (Google Account → Security → 2-Step Verification → App passwords) and use that 16-character code as `SMTP_PASS`. Your normal Gmail password will not work.

**Driver email link** — which portal link goes in the driver's welcome email.

| Key | Needed? | What it's for |
|-----|--------|---------------|
| `PORTAL_URL_DEV` | No | Link used when not in production (default `http://localhost:3000`). |
| `PORTAL_URL_PROD` | No | Link used when `NODE_ENV=production`. |

When you add a driver, the system emails them their login plus a link to the portal — the dev link during development, the production link in production. (A single `PORTAL_URL` overrides both.)

### 2. Guest app `apps/guest/.env` (copy from `apps/guest/.env.example`)

Used **only** by the guest mobile app.

| Key | Needed? | What it's for |
|-----|--------|---------------|
| `EXPO_PUBLIC_API_URL` | Yes | The backend address the phone calls. |

A phone can't reach `localhost` on your computer, so it needs your computer's **Wi-Fi (LAN) IP**. Find it with `ipconfig getifaddr en0` on Mac, then set something like `EXPO_PUBLIC_API_URL=http://192.168.1.41:4000`. If you use the iOS Simulator instead of a real phone, `http://localhost:4000` is fine.

> **Note:** the root `.env` and `apps/guest/.env` are ignored by git; the `.env.example` files are committed. Before sharing the repo, make sure the `.env.example` files hold placeholder values, not real passwords or keys.

---

## Running everything

Open three terminals — one per process:

```bash
pnpm api          # the backend API        -> http://localhost:4000
pnpm dispatch     # the matching engine     -> prints matches as they happen
pnpm portal       # the Admin/Driver website -> http://localhost:3000
```

> **Important:** the **matching engine (`pnpm dispatch`) must be running** for guests to be auto-assigned. The API by itself never assigns anyone. If you bring a driver online and nobody gets matched, it's almost always because the engine isn't running — or the event isn't inside its date window, or the driver hasn't shared a location yet.

To run the guest app on a phone:

```bash
cd apps/guest
# make sure apps/guest/.env has EXPO_PUBLIC_API_URL set to http://<your-LAN-IP>:4000
pnpm start        # scan the QR code with the Expo Go app (same Wi-Fi)
```

If Expo Go complains about an SDK version, run `npx expo install expo@latest && npx expo install --fix` inside `apps/guest`, or use the iOS Simulator (`press i`) with `localhost`.

---

## How the app is used

**Admin/Ops** (`admin@baraat.events`) creates the event, adds its saved places (venue, airport, station, hotels), and adds drivers and guests. The dashboard shows a live map of the fleet, lets ops approve ride requests, and allows manual overrides (mark a guest as priority, force-assign a specific driver, cancel a trip). It works on desktop and phone.

**Drivers** get a welcome email with their login and a link to the same portal. Their screen is one big button that walks through the trip: Accept → Arrived → enter the guest's boarding code → Drop complete. They can go online/offline, take a break, and tap to call the guest. Their location is shared automatically.

**Guests** use the mobile app. They sign in with the email and default password (`guest123`) the ops team set, and can change it in the app. It has four tabs: **Ride** (your current/upcoming ride with a live map and the driver's location), **Request** (ask for a ride — pick pickup and drop, number of people, luggage), **History** (past rides), and **Account** (profile, change password, sign out). When a driver arrives, the guest shows a 4-digit code the driver must type in to start the trip — a simple check that the right person is in the right car.

**One event at a time.** Ops run a single active event with an optional date/time window. Outside that window, nobody can request, accept, or be assigned a ride. Ending an event moves it to a read-only archive (it can't be restarted), and you must end the current event before starting a new one.

---

## Architecture (and why these tech choices)

Here's the whole picture and the reasoning behind each decision.

```
                       +-------------------------------+
 Guest app (phone) --->|                               |
                       |   BACKEND (one API, one DB)   |---> Postgres
 Admin + Driver        |   Node + Express + Prisma     |
  (web browser)  --->  +-------------------------------+
     |                        ^                ^
     v                        |                | same code + same DB
 +---------------------+      |         +---------------------------+
 | Next.js server      |------+         | MATCHING ENGINE           |
 | (thin: cookies +    |                | (always-on loop that      |
 |  token proxy only)  |                |  keeps assigning drivers) |
 +---------------------+                +---------------------------+
```

**One backend and one database — not microservices.** The core action is: "give this guest to this driver, only if the seats and luggage fit and the deadline still works, then mark the driver busy." That has to happen as one all-or-nothing step over both the guest's and the driver's data. If those lived in separate services with separate databases, every single assignment would become a fragile cross-service transaction. So there's one database (**Postgres**) and one app that owns all the writes. Postgres also gives real transactions and row-level security, which this app leans on heavily.

**The engine runs as a separate always-on process.** The API answers requests and then stops; the matching engine is a loop that never stops — every few seconds it looks at who's waiting and who's free and assigns rides. Those are two different shapes of program, so they're two processes that **share the same code and database**. The big benefit: if the engine crashes, the API and the admin's manual controls keep working, and in-progress trips are safe because their state is in the database, not in the engine's memory.

**Node + Express + TypeScript for the backend.** One language across the whole stack (backend, engine, website, mobile app) means shared types and no context-switching. Express is small and predictable — easy to add the role checks and transaction logic this app needs. TypeScript catches mistakes before they run, which matters a lot when money and people's rides are involved.

**Prisma for the database.** It gives type-safe queries that match the TypeScript everywhere else, and clean migrations. One twist: it's set up in **engine-less mode** (a pure TypeScript client with a node-postgres driver) so there are no heavy binary files to download or ship — it deploys small and behaves the same locally and on Supabase.

**Postgres + Supabase.** Supabase is hosted Postgres with a generous free tier, so there's no database server to babysit, and it can grow with the project. Because it's plain Postgres, the same **row-level security** rules run locally and in the cloud unchanged.

**Next.js for the web portal — kept deliberately thin.** Browsers can't safely store login tokens, so the website uses a small Next.js server layer: it keeps the session in a secure cookie and forwards requests to the API with the token attached. It has **no business logic and no database access** — that keeps the "one backend" rule honest. Admin and Driver are just two views inside this one app, gated by role. **Tailwind CSS** styles it quickly and consistently, and the maps use **Leaflet + OpenStreetMap** so the portal needs no map API key.

**React Native (Expo) for the guest app.** Guests are on phones, and Expo gives one codebase for iOS and Android plus easy access to the camera-free essentials this app needs — GPS location, secure token storage (device keychain), maps, and push notifications — without native build headaches during development. Unlike the website, the app stores tokens securely on the device and talks to the backend directly.

**Two layers of access control.** First, every API route checks the user's role (admin / driver / guest). Second, Postgres row-level security enforces the same rules *inside the database*, so even a bug can't let one driver read another driver's trips. Belt and suspenders, because privacy here is guest safety.

**A maps adapter with a free fallback.** All map/distance calls go through one small module. With a Google key it uses real traffic and roads; without one it uses a built-in offline estimator. So development and testing cost nothing and never depend on the network, and switching to real maps is just adding a key.

**Redis is optional.** The waiting-list queue and map cache can use Redis for speed, but the queue is always rebuilt from Postgres each cycle — so the database is the source of truth and losing Redis loses nothing. Without a Redis URL it just runs in memory.

### How the matching actually works (in plain terms)

- **Known arrivals (planned ahead):** guests going to the same hotel around the same time are grouped, then matched to drivers as an optimal batch (the classic assignment problem, solved with the Hungarian algorithm). This shares cars efficiently.
- **On-the-spot requests:** for each waiting guest, the engine filters to drivers who can actually fit them and reach them in time, scores them by how soon they'd arrive, and picks the best — in milliseconds.
- **Nobody gets stuck waiting:** the longer a guest waits, the higher they rise in the queue, so newer requests can't keep jumping ahead of them.
- **Smart detours:** a driver already on a trip can pick up a nearby waiting guest on the way, if it barely adds time and the car still fits everyone.
- **Constant re-checking:** ETAs update as traffic changes; a not-yet-started trip whose timing breaks gets cancelled and re-queued — but a trip already underway is never yanked around.
- **Driver breaks:** after several trips in a row, a driver gets a short automatic break.
- **Only during the event:** all of this happens only inside the event's date window — never before it starts or after it ends.

---

## Trade-offs and limitations

- **Batch matching uses per-round optimal assignment, not a full routing solver.** A true multi-stop vehicle-routing solver (like Google OR-Tools) would squeeze out slightly better car-sharing, but it needs a separate Python service and is much slower. The grouping-plus-Hungarian approach gets very close, stays in one language, and runs in milliseconds for up to ~100 drivers. If the fleet grows past ~150 vehicles, adding an OR-Tools helper is the planned next step.
- **Detour checking looks at every busy-driver / waiting-guest pair.** That's fine at this scale, but beyond ~100 drivers it would need a spatial index to stay fast.
- **The offline map estimator isn't real roads.** Without a Google key, distances are straight-line with simulated traffic — good enough to run and test everything, but not accurate street routing.
- **The in-memory queue assumes a single engine process.** Running several engine copies at once would require Redis as the shared queue (the code already targets that interface, so it's a config change, not a rewrite).
- **One active event at a time by design.** The system archives past events but runs one at a time. Serving several events or clients simultaneously would need an extra scoping layer — deliberately left out to keep this simple.
- **Push notifications are best-effort.** A ride is never blocked because a notification failed to send, and everything a notification says is also visible by refreshing in the app — so the app works fully even without notification permission.
