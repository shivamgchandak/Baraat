# Baraat — Design Document

Matching algorithm, architecture rationale, and the trade-offs behind them.

## 1. The problem, precisely

At a private event, guests appear in two ways: **scheduled** (known flight/train ETA, registered ahead) and **on-demand** (walk-ins, changed plans, admin-approved ad-hoc requests). A fixed fleet of pre-registered vehicles with hard seat/luggage capacities must serve both, across multiple simultaneous destinations (several hotels, one venue, airport, station), such that:

- no guest waits unreasonably or is starved by newer requests,
- no vehicle idles while guests wait,
- capacity is never exceeded,
- deadlines (e.g. "must reach the venue by the muhurat") are honored,
- and nobody — guest or driver — ever picks a match manually.

This is a rolling-horizon Vehicle Routing Problem with time windows. Solving it *exactly* in real time is neither possible nor necessary; the design splits it into regimes where each technique is near-optimal and fast.

## 2. Engine design

### 2.1 Pre-day batch — assignment problem, solved optimally

For guests with known arrival times, the engine runs offline rounds:

1. **Cluster** guests heading to the same accommodation whose pickups are within 1.5 km and whose arrival windows overlap (20 min), capped by the fleet's largest vehicle. A cluster inherits its tightest member deadline.
2. **Cost matrix** over (available driver × cluster): `cost = ETA(driver predicted-free position → pickup) + slack penalty`, where the slack penalty grows as arrival margin before the deadline shrinks below 15 min. Capacity or deadline misses are `INFEASIBLE`.
3. **Hungarian algorithm** (`munkres-js`) gives the optimal one-to-one matching per round in O(n³) — sub-millisecond at 10–100 drivers.
4. More clusters than drivers → clusters sorted by deadline roll into subsequent rounds against drivers' *predicted free* time and location.

**Trade-off:** with capacity + multi-stop routing this is really a VRP; OR-Tools would squeeze out a few more shared kilometres. The clustering pre-pass captures most of that gain, keeps the stack single-language, and stays fast. Exit condition: fleet > ~150 vehicles or hard multi-pickup routes → OR-Tools sidecar for batch rounds only (greedy path stays as is).

### 2.2 Real-time greedy — milliseconds, between batches

For each queued guest, in aged-priority order: filter drivers to those not on break, with enough free seats/luggage, whose `predictedFreeAt + ETA(pickup)` still meets the guest's deadline; score by `ETA-to-pickup + 0.8 × seconds-until-free`; assign the best. Assignment is one Postgres transaction: trip + trip-guests + guest status + driver predicted-free state.

Within a tick, chosen drivers are marked busy in the in-memory snapshot immediately, so a burst of requests spreads across the fleet instead of piling onto the nearest driver.

**Fleet escalation:** a group larger than any vehicle is split greedily across multiple vehicles (largest remaining capacity first, same pickup and destination — "split & coordinate"). If the whole group still can't be placed, the guest stays queued and surfaces in the admin's *unmatched* list for override.

### 2.3 No-starvation priority queue

Queue score (lower = served sooner):

```
score = deadline − 2 × waited_seconds − priority_bonus
```

Every second waited counts double against the deadline, so a guest with a loose deadline who has waited long enough overtakes fresher, tighter-deadline guests — bounded unfairness, no starvation. Admin-flagged priority guests get a fixed ~1 h bonus.

Implementation: sorted set in the KV layer (Redis in production, in-memory fallback otherwise), **rebuilt from Postgres each tick**. Redis is an accelerator, never a source of truth — losing it loses nothing.

### 2.4 Detour insertion — including trips already in progress

Every tick, before greedy matching (detours consume zero extra vehicles): for each busy driver (EN_ROUTE_PICKUP or OCCUPIED), from their **live GPS position**, splice a waiting guest's pickup into the remaining route — trying both orderings when the driver hasn't reached the original pickup yet. Accept only if added time ≤ 8 min, remaining capacity fits, the trip's existing deadline still holds, and the new guest's own deadline holds. Guest destination must be within 2 km of the trip's destination.

### 2.5 Continuous re-optimization, without thrashing

ETAs for all active trips are recomputed each tick as traffic changes. Three guards keep it stable: drifts under 2 minutes are ignored; **in-progress trips are never reassigned** (passengers aren't ping-ponged between cars); only not-yet-accepted assignments whose deadline has become unreachable are cancelled — their guests re-queue keeping the original `waitingSince`, so aging protects exactly the people the traffic hurt.

### 2.6 Driver welfare

After 4 consecutive trips, a driver goes ON_BREAK for 15 minutes and is invisible to matching; trip completion, `tripsSinceBreak`, and `predictedFreeAt` are updated in the same transaction as the status transition.

## 3. Architecture rationale

**One backend, one database.** Assignment reasons over guest state *and* driver state at once and commits atomically. Per-service databases would turn "assign, respect capacity, honor deadline" into a distributed transaction with compensation logic — maximal complexity for negative benefit at this scale.

**Persistent worker, not serverless.** The engine is a loop (batch rounds, queue aging, re-optimization) — it has no request/response lifecycle. The API stays serverless-friendly; the worker runs on a persistent host. Separating them is also the reliability story: if the engine dies, in-progress trips (state in Postgres) are untouched and admin manual override — a plain API path — keeps working.

**RLS, not just middleware.** RBAC guards in Express are the first fence; Postgres row-level security (forced, keyed off per-transaction `app.user_id`/`app.role` settings) is the second. A compromised or buggy driver-role request physically cannot read another driver's trips. The same policy shapes port to Supabase JWT claims.

**Maps cost control.** Distance Matrix over single-pair calls (one call covers 25×25), a two-tier cache (60 s for traffic-fresh legs, 6 h for static legs like hotel→venue) keyed on a ~110 m grid, and a provider interface that swaps in a deterministic mock — so development and CI burn zero quota.

**Engine-less Prisma.** `engineType = "client"` + node-postgres driver adapter: no Rust binaries to download or ship, identical behavior against local Postgres and Supabase.

## 4. What I'd do next

OR-Tools batch sidecar past ~150 vehicles; spatial index for detour candidate pruning; Supabase Realtime channels for live location fan-out (schema already carries everything needed); push notifications with the client apps; multi-event support via an `eventId` scope column + one extra RLS predicate.
