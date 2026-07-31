/**
 * Baraat dispatch worker — the always-on matching loop.
 *
 * Runs as a separate persistent process (NOT serverless): a background loop
 * cannot live in a request/response lifecycle. If this process dies,
 * in-progress trips are untouched (state lives in Postgres) and admin
 * manual override in the API keeps working — reliability by architecture.
 *
 * Each tick:
 *   1. wake drivers whose break has ended
 *   2. rebuild the aging priority queue from DB state
 *   3. try detour insertion into in-progress trips (cheapest capacity)
 *   4. greedy-match remaining queued guests to free drivers
 *   5. re-optimize ETAs under live traffic; requeue broken assignments
 *
 * `pnpm --filter @baraat/dispatch simulate` runs the peak-arrival scenario.
 * Batch mode (pre-day): `tsx src/index.ts --batch` runs one Hungarian round
 * over guests with known arrival times, then exits.
 */
import { TripType } from "@baraat/db";
import { ENGINE } from "@baraat/types";
import { loadDrivers, loadWaitingGuests } from "./engine/state.js";
import { orderedQueue } from "./engine/queue.js";
import { greedyMatchOne } from "./engine/greedy.js";
import { tryDetourInsertion } from "./engine/detour.js";
import { endFinishedBreaks, reoptimize } from "./engine/reoptimize.js";
import { runBatch } from "./engine/batch.js";

export async function tick(): Promise<void> {
  const now = new Date();
  const woken = await endFinishedBreaks();
  if (woken > 0) console.log(`[BREAK] ${woken} driver(s) back from break`);

  const [drivers, waiting] = await Promise.all([loadDrivers(), loadWaitingGuests()]);
  if (waiting.length === 0) return;

  const queue = await orderedQueue(waiting, now);

  // 3. Detours first — they consume zero extra vehicles.
  const detoured = await tryDetourInsertion(drivers, queue);
  const detouredIds = new Set(detoured.map((d) => d.guestId));

  // 4. Greedy for the rest, in queue (aged-priority) order.
  const freshDrivers = await loadDrivers(); // detours changed seat usage
  for (const guest of queue) {
    if (detouredIds.has(guest.id)) continue;
    const result = await greedyMatchOne(guest, freshDrivers, TripType.ON_DEMAND);
    if (result.outcome === "NO_FEASIBLE_DRIVER") {
      // stays WAITING; aging pushes them up next tick; admin sees them
      // under /admin/upcoming -> unmatched.
      continue;
    }
    // greedyMatchOne mutates the driver snapshot (activeTripId, seatsInUse),
    // so subsequent guests in this tick see up-to-date availability.
  }

  // 5. Live-traffic re-optimization.
  const r = await reoptimize();
  if (r.etaUpdates || r.requeued) {
    console.log(`[REOPT] etaUpdates=${r.etaUpdates} requeued=${r.requeued}`);
  }
}

async function main(): Promise<void> {
  if (process.argv.includes("--batch")) {
    const [drivers, waiting] = await Promise.all([loadDrivers(), loadWaitingGuests()]);
    const known = waiting.filter((g) => g.flightTrainEta !== null);
    console.log(`[BATCH] pre-day round: ${known.length} guests, ${drivers.length} drivers`);
    const res = await runBatch(drivers, known, TripType.ARRIVAL);
    console.log(
      `[BATCH] assigned=${res.assigned} unassignedClusters=${res.unassignedClusters.length}`,
    );
    process.exit(0);
  }

  console.log(`baraat-dispatch worker up (tick=${ENGINE.TICK_MS}ms)`);
  // Serial loop (no overlapping ticks).
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const started = Date.now();
    try {
      await tick();
    } catch (err) {
      // Engine failure must never take state down with it — log and keep going.
      console.error("[TICK ERROR]", err);
    }
    const elapsed = Date.now() - started;
    await new Promise((r) => setTimeout(r, Math.max(0, ENGINE.TICK_MS - elapsed)));
  }
}

const isDirectRun = process.argv[1]?.endsWith("index.ts") || process.argv[1]?.endsWith("index.js");
if (isDirectRun) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
