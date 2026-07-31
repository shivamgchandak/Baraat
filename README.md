# Baraat — Event Dispatch System

A mobile-first dispatch system for a single private group event (wedding / conference / offsite). It automatically assigns a pre-registered fleet of drivers to guests based on location, timing, vehicle capacity, and live traffic — like a ride-hailing app, but for a fixed, scheduled, multi-stop event.

> *Baraat* — the groom's procession. Everyone arrives together, nobody gets left behind.

**Status: Phases 1–2 complete** (backend + Admin Portal). Guest app (Expo) is Phase 3.

## Architecture

One brain, two faces, one memory, plus a worker.

```
                   +-----------------------------+
 Guest (RN Expo) ->|                             |
  secure token,    |   APPLICATION BACKEND       |
  direct calls     |   Node + Express + Prisma   |--> Postgres
                   |   auth . RBAC . CRUD .      |    (Supabase,
 Admin (browser)   |   engine API                |     single DB)
     |             +-----------------------------+
     |                    ^              ^
     v                    |              | shares packages/db
 +--------------------+   |        +--------------------------+
 | Next.js server     |---+        | DISPATCH WORKER          |
 | THIN: cookie auth, |            | always-on loop: batch .  |
 | secrets, BFF       |            | queue aging . detours .  |
 | (Tailwind UI)      |            | re-optimization          |
 +--------------------+            +--------------------------+
```

- **One backend + one DB** — assignment ("this driver serves this guest, respecting capacity and deadline") must be a single atomic transaction over driver state and guest state together. Multiple services/DBs would make every assignment a distributed transaction — the exact failure mode this domain cannot afford.
- **Monolith-with-a-worker, not microservices** — the transactional API is serverless-friendly; the matching engine is an always-on loop and needs a persistent host. Same codebase, same Prisma client, separate process — so an engine crash never takes the API (and admin manual override) down with it.
- **Extraction later, not now** — notifications and the engine become separate services only when peak-arrival load justifies independent scaling. Named exit condition, no premature infrastructure.

### Monorepo layout

```
apps/
  portal        -> Next.js App Router + Tailwind (Admin + Driver roles)
  guest         -> React Native Expo (Phase 3)
services/
  api           -> Express + Prisma: auth, RBAC, CRUD, trip flows, overrides
  dispatch      -> always-on matching worker + peak-arrival simulation
packages/
  db            -> Prisma schema, generated client, RLS SQL, seed
  types         -> shared TS types + engine tuning constants
  maps          -> maps adapter: Google (Distance Matrix / Directions) or mock
  kv            -> Redis abstraction with in-memory fallback (queue + cache)
  config        -> shared tsconfig / tailwind preset
```

## Local setup

Prerequisites: Node 22+, pnpm 9+, a Postgres database (local or Supabase).

```bash
pnpm install
cp .env.example .env          # point DATABASE_URL/DIRECT_URL at your Postgres

pnpm --filter @baraat/db generate         # generate Prisma client
pnpm --filter @baraat/db migrate:deploy   # apply migrations
pnpm --filter @baraat/db rls:apply        # apply row-level security policies
pnpm db:seed                              # venue, airport, 3 hotels, 8 drivers, 20 guests

pnpm api                # Express API on :4000
pnpm dispatch           # matching worker (separate terminal)
pnpm portal             # Admin Portal on :3000 (separate terminal)
```

All seeded logins use password `password123`: `admin@baraat.events`, `driver1..8@baraat.events`, `guest1..20@example.com`.

`GOOGLE_MAPS_API_KEY` is optional — without it the maps adapter uses a deterministic haversine + time-varying-traffic mock, so everything (including the simulation) runs with zero external calls. `REDIS_URL` is optional too — the KV layer falls back to in-memory.

### The Admin Portal (`apps/portal`)

One Next.js app, two role experiences, opened at `http://localhost:3000`:

- **Admin/Ops** (`admin@baraat.events`) — live dashboard with a fleet map (Leaflet + OpenStreetMap, no API key), guest/driver/trip management, ride-request approvals with a badge counter, manual overrides (priority, force-assign with capacity-aware driver picker, cancel/breakdown). Fully responsive: sidebar on desktop, bottom tabs on phone.
- **Driver** (`driver1@baraat.events`) — mobile-first single-trip screen: one big lifecycle button (Accept → Arrived → Boarded → Drop complete), reject option, tap-to-call guests, automatic live location sharing via browser geolocation, online/offline toggle, and a break state.

Light theme by default with a one-tap dark mode (remembered per device — drivers at night will thank you). The Next.js server layer is deliberately thin: httpOnly cookie session, a passthrough proxy that attaches the Bearer token (with transparent refresh rotation), and role-gating middleware — no Prisma, no business logic, per the architecture rule. Guests are refused portal login entirely.

### Try the API

`requests.http` at the repo root covers every endpoint (VS Code REST Client / IntelliJ): login for all three roles, admin overview, driver trip transitions, guest on-demand requests, manual overrides, and an RBAC check (driver hitting an admin endpoint → 403).

### Run the peak-arrival simulation

```bash
pnpm simulate
```

What it does:

1. Runs the pre-day **batch round** (Hungarian assignment) over the 20 seeded guests with known flight/train ETAs.
2. Fires a **peak burst**: 25 walk-in guests (including a 14-person group) raise on-demand requests at the airport within seconds.
3. Runs the real engine loop while a driver-bot plays every driver through accept → arrive → board → drop (with occasional rejections to exercise re-queueing).
4. Prints a report: waits, shared rides, capacity violations, deadline violations.

Sample result: 45/45 guests served, 10 shared rides, 0 capacity violations, 0 deadline violations. `SIM_SPEEDUP`, `SIM_BURST`, `SIM_STEPS`, `SIM_STEP_MS` env vars control scale/speed.

## Matching algorithm

See [DESIGN.md](./DESIGN.md) for the full design document. Summary:

- **Pre-day batch (scheduled arrivals)** — cluster same-accommodation guests, then solve the assignment problem optimally per round with the **Hungarian algorithm** (`munkres-js`). Cost = ETA to pickup + slack penalty; capacity or deadline misses are infeasible. More clusters than drivers → multiple rounds, tightest deadlines first.
- **Real-time greedy (on-demand)** — feasibility filter (capacity, deadline, not on break), score = ETA-to-pickup + how-soon-free. Resolves in milliseconds. Groups larger than any vehicle are **split across multiple vehicles**, largest first.
- **No-starvation queue** — sorted-set queue where waiting time counts double against the deadline score, so long-waiting guests always bubble up. Rebuilt from Postgres each tick; Redis is an accelerator, never the source of truth.
- **Detour insertion (in-progress trips)** — a driver already en route can absorb a compatible guest using their **live position**, only if added time ≤ 8 min, capacity fits, and no existing deadline breaks.
- **Continuous re-optimization** — ETAs refreshed as (mock or real) traffic changes; only material drifts persisted (anti-thrash); not-yet-accepted trips whose deadline becomes unreachable are cancelled and re-queued. In-progress trips are never reassigned.
- **Driver breaks** — after 4 consecutive trips a driver goes ON_BREAK for 15 minutes and is skipped by matching.

## Role separation (RBAC + RLS)

Two layers:

1. **App-layer RBAC** — JWT with a role claim; `requireRole('ADMIN' | 'DRIVER' | 'GUEST')` guards on every route.
2. **DB-layer RLS** — Postgres row-level security (`packages/db/sql/rls.sql`), `FORCE`d so it applies even to the table owner. Driver- and guest-scoped API requests run inside a transaction that sets `app.user_id` / `app.role`; policies make it *physically impossible* for a driver's queries to return other drivers' trips or the ops-level view. On Supabase the same policies key off JWT claims.

## Known trade-offs & limitations

- **Hungarian per-round instead of a full VRP solver.** True multi-stop capacity optimization is a Vehicle Routing Problem (OR-Tools territory). Clustering pre-pass + optimal one-to-one rounds gets near-optimal results at 10–100 drivers in milliseconds, with no Python sidecar. The OR-Tools microservice is the named next step if fleet size grows.
- **Detour search is exhaustive per (guest, busy-driver) pair.** Fine at this scale (≤100 drivers); would need spatial indexing beyond it.
- **Mock traffic model** stands in for Google when no API key is set — deterministic and time-varying so re-optimization is exercised, but not real roads.
- **Push notifications stubbed** — assignment events are logged; Expo Notifications / FCM land with the client apps (Phases 2–3).
- **Single event by design** (per scope). Multi-tenancy would add an `eventId` scope column + RLS predicate.
- **Engine-less Prisma client** (`engineType = "client"` + node-postgres driver adapter) — no Rust binaries, smaller deploys, works identically against Supabase.

## Deploy shape

API + dispatch worker on a persistent host (Render / Railway / Fly), portal on Vercel, Postgres + Realtime on Supabase, Redis optional (Upstash).
