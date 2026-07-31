/**
 * Pre-day batch assignment — the "assignment problem" solved optimally.
 *
 * 1. Cluster same-accommodation guests (shared rides).
 * 2. Build cost matrix: cost(driver, cluster) =
 *      ETA from driver's predicted-free position to pickup
 *    + slack penalty (arriving with little margin before the deadline)
 *    + INFEASIBLE if capacity or deadline cannot be met.
 * 3. Hungarian algorithm (munkres-js) for the optimal one-to-one round.
 * 4. More clusters than drivers -> multiple rounds; unassigned clusters
 *    roll into the next round ordered by deadline (tightest first).
 *
 * Trade-off (documented in README): full capacity+multi-stop optimization
 * is a VRP — OR-Tools territory. Hungarian per round + clustering pre-pass
 * gets near-optimal results at this scale (10–100 drivers) in milliseconds.
 */
import munkres from "munkres-js";
import { DriverStatus, TripType } from "@baraat/db";
import { etaMatrix } from "@baraat/maps";
import type { Cluster } from "./clustering.js";
import { clusterGuests } from "./clustering.js";
import type { DriverSnapshot, GuestSnapshot } from "./state.js";
import { persistAssignment } from "./assign.js";

const INFEASIBLE = 1e9;
const SLACK_PENALTY_PER_MIN = 30; // seconds of cost per minute of missing slack

export async function runBatch(
  drivers: DriverSnapshot[],
  guests: GuestSnapshot[],
  tripType: TripType = TripType.ARRIVAL,
): Promise<{ assigned: number; unassignedClusters: Cluster[] }> {
  const available = drivers.filter(
    (d) => d.status === DriverStatus.IDLE || d.status === DriverStatus.OFFLINE === false,
  );
  const usable = available.filter((d) => d.status !== DriverStatus.ON_BREAK);
  if (usable.length === 0 || guests.length === 0) {
    return { assigned: 0, unassignedClusters: [] };
  }

  const maxSeats = Math.max(...usable.map((d) => d.seatCapacity));
  const maxLuggage = Math.max(...usable.map((d) => d.luggageCapacity));
  let clusters = clusterGuests(guests, maxSeats, maxLuggage).sort(
    (a, b) => (a.deadline?.getTime() ?? Infinity) - (b.deadline?.getTime() ?? Infinity),
  );

  let assigned = 0;
  let freeDrivers = [...usable];
  const leftovers: Cluster[] = [];

  while (clusters.length > 0 && freeDrivers.length > 0) {
    const round = clusters.slice(0, freeDrivers.length);
    clusters = clusters.slice(freeDrivers.length);

    // Bulk ETA matrix: drivers' free positions -> cluster pickups (batched).
    const origins = freeDrivers.map((d) => ({
      lat: d.predictedFreeLat ?? d.lat ?? 0,
      lng: d.predictedFreeLng ?? d.lng ?? 0,
    }));
    const destinations = round.map((c) => ({ lat: c.lat, lng: c.lng }));
    const matrix = await etaMatrix(origins, destinations);

    const now = Date.now();
    const cost: number[][] = freeDrivers.map((d, di) =>
      round.map((c, ci) => {
        const m = matrix[di]![ci]!;
        if (c.totalSeats > d.seatCapacity || c.totalLuggage > d.luggageCapacity)
          return INFEASIBLE;
        const readyAt = Math.max(d.predictedFreeAt?.getTime() ?? now, now);
        const arriveAt = readyAt + m.seconds * 1000;
        if (c.deadline && arriveAt > c.deadline.getTime()) return INFEASIBLE;
        const slackMin = c.deadline ? (c.deadline.getTime() - arriveAt) / 60_000 : 30;
        const slackPenalty = Math.max(0, 15 - slackMin) * SLACK_PENALTY_PER_MIN;
        return m.seconds + slackPenalty;
      }),
    );

    const pairs = munkres(cost) as [number, number][];
    const usedDrivers = new Set<number>();
    for (const [di, ci] of pairs) {
      if (di >= freeDrivers.length || ci >= round.length) continue;
      if (cost[di]![ci]! >= INFEASIBLE) {
        leftovers.push(round[ci]!);
        continue;
      }
      await persistAssignment(freeDrivers[di]!, round[ci]!, tripType, "BATCH");
      usedDrivers.add(di);
      assigned += round[ci]!.guests.length;
    }
    freeDrivers = freeDrivers.filter((_, i) => !usedDrivers.has(i));
  }

  leftovers.push(...clusters);
  return { assigned, unassignedClusters: leftovers };
}
