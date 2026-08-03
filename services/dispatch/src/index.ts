
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

  const detoured = await tryDetourInsertion(drivers, queue);
  const detouredIds = new Set(detoured.map((d) => d.guestId));

  const freshDrivers = await loadDrivers();
  for (const guest of queue) {
    if (detouredIds.has(guest.id)) continue;
    const result = await greedyMatchOne(guest, freshDrivers, TripType.ON_DEMAND);
    if (result.outcome === "NO_FEASIBLE_DRIVER") {

      continue;
    }
  }

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

  while (true) {
    const started = Date.now();
    try {
      await tick();
    } catch (err) {

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
