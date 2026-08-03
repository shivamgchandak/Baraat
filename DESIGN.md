# Baraat — Design Document

The problem, the system that solves it, the matching algorithm, and the trade-offs behind each decision.

---

## 1. The problem, precisely

At a private event, guests appear in two ways:

- **Scheduled** — a known flight/train ETA, registered ahead of time by the ops team.
- **On-demand** — walk-ins, changed plans, or ad-hoc requests the guest raises and ops approve.

A **fixed fleet** of pre-registered vehicles, each with hard seat and luggage capacities, must serve both across multiple simultaneous destinations (several hotels, one venue, an airport, a station) such that:

- no guest waits unreasonably or is starved by newer requests,
- no vehicle idles while guests wait,
- capacity is never exceeded,
- deadlines (e.g. "must reach the venue by the muhurat") are honored,
- everything happens **only within the event's date window**,
- and nobody — guest or driver — ever picks a match manually.

Formally this is a rolling-horizon **Vehicle Routing Problem with time windows and capacities**. Solving it *exactly* in real time is neither possible nor necessary. The design splits it into regimes where each technique is near-optimal *and* fast.

---

## 2. System architecture

### 2.1 One backend, one database

An assignment reasons over guest state *and* driver state at the same instant — "give this guest to this driver, only if seats and luggage fit and the deadline still holds, then mark the driver busy" — and must commit **atomically**. With per-service databases this becomes a distributed transaction with compensation logic: maximal complexity for negative benefit at this scale. So there is a single Postgres database and a single application backend that owns all writes.

### 2.2 A persistent worker, not serverless

The backend splits into two processes that share the same code and the same Prisma client:

- **`services/api`** — a request/response Express app: auth, RBAC, CRUD, trip-state transitions, admin overrides. This is serverless-friendly and horizontally scalable.
- **`services/dispatch`** — an **always-on loop** (default every 5 s): batch rounds, queue aging, detour insertion, re-optimization. It has no request/response lifecycle, so it wants a persistent host.

Separating them is also the reliability story. If the engine crashes, in-progress trips are safe (their state is in Postgres) and the admin's manual-override path — a plain API route — keeps working. An engine bug can never take down the ability for ops to move people by hand.

### 2.3 A thin web tier

Browsers can't hold bearer tokens safely, so the portal is a **thin Next.js server**: an httpOnly cookie session, a passthrough proxy that attaches the bearer token (with transparent refresh-token rotation), and role-gating middleware. It holds **no business logic and no Prisma** — that discipline is what keeps "one backend" true rather than aspirational. The guest app, by contrast, is native and stores tokens in the device keychain, so it calls the backend directly. Same API, two idiomatic access patterns.

### 2.4 Engine-less Prisma

The Prisma client is generated with `engineType = "client"` plus the node-postgres driver adapter — a TypeScript query compiler and a JS driver, **no Rust engine binaries**. Smaller deploys, no binary-download step, and identical behavior against local Postgres and Supabase.

---

## 3. Matching engine

### 3.1 Everything is scoped to the live event

Before any matching, the engine loads only guests belonging to the **currently active event** whose date window contains *now*. If the event hasn't started, has ended, or is closed, the waiting set is empty and nothing is assigned. This is the single gate that enforces "no rides outside the event window" on the engine side; the API enforces the same rule on requests, accepts, and pickup scheduling.

A guest enters the matching pool only once `waitingSince` is set — the "released to the dispatch queue" marker. A pre-registered guest with a pickup is released immediately; an on-demand request is released when ops approve it. A merely-pending request is never auto-assigned.

### 3.2 Pre-day batch — assignment problem, solved optimally

For guests with known arrival times, the engine runs offline rounds:

1. **Cluster** guests heading to the same accommodation whose pickups are within ~1.5 km and whose arrival windows overlap (~20 min), capped by the fleet's largest vehicle. A cluster inherits its tightest member deadline.
2. **Build a cost matrix** over (available driver × cluster): `cost = ETA(driver's predicted-free position → pickup) + slack penalty`, where the slack penalty grows as the arrival margin before the deadline drops below ~15 min. Capacity or deadline misses are `INFEASIBLE`.
3. **Solve** each round optimally with the **Hungarian algorithm** (`munkres-js`) — an O(n³) one-to-one matching, sub-millisecond at 10–100 drivers.
4. More clusters than drivers → clusters sort by deadline and roll into subsequent rounds against drivers' *predicted-free* time and location.

**Trade-off:** with capacity plus multi-stop routing this is really a VRP, and OR-Tools would squeeze out a few more shared kilometres. The clustering pre-pass captures most of that gain, keeps the stack single-language, and stays fast. **Exit condition:** fleet beyond ~150 vehicles, or hard multi-pickup routes, → an OR-Tools sidecar for batch rounds only (the greedy path stays as is).

### 3.3 Real-time greedy — milliseconds, between batches

For each queued guest, in aged-priority order:

- filter drivers to those not on break, online, idle, with enough free seats/luggage, whose `predictedFreeAt + ETA(pickup)` still meets the guest's deadline;
- score each by `ETA-to-pickup + 0.8 × seconds-until-free`;
- assign the best. The assignment is one Postgres transaction: trip + trip-guests + guest status + driver predicted-free state.

Within a tick, chosen drivers are marked busy in the **in-memory snapshot immediately**, so a burst of requests fans out across the fleet instead of piling onto the single nearest driver.

**Fleet escalation:** a group larger than any single vehicle is **split greedily across multiple vehicles** (largest remaining capacity first, same pickup and destination). If the whole group still can't be placed, the guest stays queued and surfaces in the admin's *unmatched* list for a manual override.

### 3.4 No-starvation priority queue

Queue score (lower = served sooner):

```
score = deadline − 2 × waited_seconds − priority_bonus
```

Every second waited counts **double** against the deadline, so a guest with a loose deadline who has waited long enough overtakes fresher, tighter-deadline guests — bounded unfairness, never starvation. Admin-flagged priority guests get a fixed bonus (~1 h).

Implementation: a sorted set in the KV layer (Redis in production, in-memory otherwise), **rebuilt from Postgres every tick**. Redis is an accelerator, never a source of truth — losing it loses nothing.

### 3.5 Detour insertion — including trips already in progress

Every tick, *before* greedy matching (detours consume zero extra vehicles): for each busy driver, from their **live GPS position**, try to splice a waiting guest's pickup into the remaining route — trying both orderings when the driver hasn't reached the original pickup yet. Accept only if added time ≤ ~8 min, remaining capacity fits, the trip's existing deadline still holds, and the new guest's own deadline holds; the guest's destination must be within ~2 km of the trip's destination.

### 3.6 Continuous re-optimization, without thrashing

ETAs for all active trips are recomputed each tick as traffic changes. Three guards keep it stable:

- drifts under ~2 minutes are ignored (anti-thrash);
- **in-progress trips are never reassigned** — passengers are never ping-ponged between cars;
- only **not-yet-accepted** assignments whose deadline has become unreachable are cancelled, and their guests re-queue keeping the original `waitingSince`, so aging protects exactly the people the traffic hurt.

### 3.7 Boarding verification

When a driver arrives, the guest generates a **4-digit boarding OTP** in the app; the driver must enter it to move the trip to `BOARDED`. The code is stored hashed (SHA-256) on the trip. This proves the right guest is in the right car before the trip starts — the human check a fully-automatic dispatcher would otherwise lack.

### 3.8 Driver welfare

After 4 consecutive trips a driver goes `ON_BREAK` for ~15 minutes and is invisible to matching. Trip completion, `tripsSinceBreak`, and `predictedFreeAt` all update in the same transaction as the status transition.

---

## 4. Security model

**RBAC, then RLS — defence in depth.**

1. **App-layer RBAC.** Every route is guarded by `requireRole('ADMIN' | 'DRIVER' | 'GUEST')`. JWTs carry a role claim; access tokens are short-lived and refresh tokens rotate (with a small grace window so concurrent refreshes don't lock a user out).
2. **DB-layer RLS.** Postgres row-level security (`packages/db/sql/rls.sql`), `FORCE`d so it applies even to the table owner. Driver- and guest-scoped requests run inside a transaction that sets `app.user_id` / `app.role`, and the policies make it *physically impossible* for a driver's query to return another driver's trips or the ops-level view. A buggy or compromised driver-role request simply cannot read data it shouldn't. On Supabase the same policy shapes key off JWT claims.

---

## 5. Maps and cost control

The maps adapter hides the provider behind one interface, so the whole system runs against a **deterministic haversine + time-varying-traffic mock** when no API key is set — development and CI burn zero quota, and the mock still varies over time so re-optimization is genuinely exercised.

With a Google key it uses **Distance Matrix** (one call covers up to 25×25 pairs instead of one call per pair) and **Directions** for road polylines, behind a two-tier cache: ~60 s for traffic-fresh legs, longer for static legs (hotel→venue), keyed on a coarse (~110 m) grid.

**Route legs are computed server-side** (`GET /trips/:id/route`): the Maps key stays off clients, one cached Directions call serves the guest app, the driver portal, and ops simultaneously, and the leg logic (pre-boarding → pickup, post-boarding → destination) lives in exactly one place.

---

## 6. Client design notes

**Guest app talks directly to the backend.** Secure token storage on device, silent refresh rotation. The web portal goes through the thin Next.js server because browsers can't store tokens safely. Same API, two access patterns matched to each platform.

**Push is best-effort by design.** An assignment must never fail because a notification failed, so push is fire-and-forget, and every state a push announces is also visible via polling — the app works fully without notification permission.

**Multi-event, single-active.** The system runs one `ACTIVE` event at a time; ended events become a read-only `CLOSED` archive. Guests, trips, and saved places carry an `eventId`, and the engine only ever loads the live event. This keeps a reused fleet's history clean across weddings without the overhead of full multi-tenancy.

---

## 7. Known trade-offs & limitations

- **Hungarian per-round instead of a full VRP solver.** Near-optimal at 10–100 drivers in milliseconds with no Python sidecar; the OR-Tools microservice is the named next step past ~150 vehicles.
- **Detour search is exhaustive per (guest, busy-driver) pair.** Fine at this scale; would need spatial indexing beyond ~100 drivers.
- **Mock traffic model** stands in for Google when no key is set — deterministic and time-varying, but not real roads.
- **In-memory KV fallback** assumes a single dispatch worker. Running multiple workers would require Redis as the shared queue (the code already targets that interface).

---

## 8. What I'd do next

- OR-Tools batch sidecar past ~150 vehicles.
- Spatial index (e.g. an R-tree / geohash grid) to prune detour candidates.
- Supabase Realtime channels for live-location fan-out instead of polling — the schema already carries everything needed.
- Full multi-tenancy (several concurrent events / clients) via an org scope column and one additional RLS predicate.
