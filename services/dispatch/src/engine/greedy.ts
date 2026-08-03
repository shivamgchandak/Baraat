
import { DriverStatus, TripType } from "@baraat/db";
import { eta } from "@baraat/maps";
import type { Cluster } from "./clustering.js";
import type { DriverSnapshot, GuestSnapshot } from "./state.js";
import { persistAssignment } from "./assign.js";

const FREE_SOON_WEIGHT = 0.8;

export interface GreedyResult {
  guestId: string;
  outcome: "ASSIGNED" | "SPLIT_ASSIGNED" | "NO_FEASIBLE_DRIVER";
  tripIds: string[];
}

export async function greedyMatchOne(
  guest: GuestSnapshot,
  drivers: DriverSnapshot[],
  tripType: TripType = TripType.ON_DEMAND,
): Promise<GreedyResult> {
  const candidates = drivers.filter(
    (d) =>
      d.status !== DriverStatus.ON_BREAK &&
      d.status !== DriverStatus.OFFLINE &&
      d.activeTripId === null,
  );

  const maxVehicle = Math.max(0, ...candidates.map((d) => d.seatCapacity));
  if (guest.groupSize > maxVehicle && candidates.length > 1) {
    return splitAcrossFleet(guest, candidates, tripType);
  }

  const scored = await scoreCandidates(guest, candidates, guest.groupSize, guest.luggageCount);
  if (scored.length === 0) {
    return { guestId: guest.id, outcome: "NO_FEASIBLE_DRIVER", tripIds: [] };
  }
  const best = scored[0]!;
  const tripId = await persistAssignment(best.driver, toCluster(guest), tripType, "GREEDY");

  best.driver.activeTripId = tripId;
  best.driver.seatsInUse += guest.groupSize;
  best.driver.luggageInUse += guest.luggageCount;
  return { guestId: guest.id, outcome: "ASSIGNED", tripIds: [tripId] };
}

async function scoreCandidates(
  guest: GuestSnapshot,
  candidates: DriverSnapshot[],
  seatsNeeded: number,
  luggageNeeded: number,
): Promise<{ driver: DriverSnapshot; score: number }[]> {
  const now = Date.now();
  const scored: { driver: DriverSnapshot; score: number }[] = [];
  for (const d of candidates) {
    if (d.seatCapacity - d.seatsInUse < seatsNeeded) continue;
    if (d.luggageCapacity - d.luggageInUse < luggageNeeded) continue;
    const from = {
      lat: d.predictedFreeLat ?? d.lat,
      lng: d.predictedFreeLng ?? d.lng,
    };
    if (from.lat == null || from.lng == null) continue;
    const e = await eta({ lat: from.lat, lng: from.lng }, { lat: guest.lat, lng: guest.lng });
    const freeInSeconds = Math.max(0, ((d.predictedFreeAt?.getTime() ?? now) - now) / 1000);
    const arriveAt = now + (freeInSeconds + e.seconds) * 1000;
    if (guest.deadline && arriveAt > guest.deadline.getTime()) continue;
    scored.push({ driver: d, score: e.seconds + freeInSeconds * FREE_SOON_WEIGHT });
  }
  return scored.sort((a, b) => a.score - b.score);
}

async function splitAcrossFleet(
  guest: GuestSnapshot,
  candidates: DriverSnapshot[],
  tripType: TripType,
): Promise<GreedyResult> {
  const sorted = [...candidates].sort((a, b) => b.seatCapacity - a.seatCapacity);
  let seatsLeft = guest.groupSize;
  let luggageLeft = guest.luggageCount;
  const tripIds: string[] = [];
  for (const d of sorted) {
    if (seatsLeft <= 0) break;
    const seats = Math.min(seatsLeft, d.seatCapacity - d.seatsInUse);
    if (seats <= 0) continue;
    const luggage = Math.min(luggageLeft, d.luggageCapacity - d.luggageInUse);
    const part: Cluster = {
      ...toCluster(guest),
      totalSeats: seats,
      totalLuggage: luggage,
    };
    const tripId = await persistAssignment(d, part, tripType, "GREEDY");
    tripIds.push(tripId);
    d.activeTripId = tripId;
    d.seatsInUse += seats;
    d.luggageInUse += luggage;
    seatsLeft -= seats;
    luggageLeft -= luggage;
  }
  if (seatsLeft > 0) {

    return { guestId: guest.id, outcome: "NO_FEASIBLE_DRIVER", tripIds };
  }
  return { guestId: guest.id, outcome: "SPLIT_ASSIGNED", tripIds };
}

function toCluster(g: GuestSnapshot): Cluster {
  return {
    guests: [g],
    totalSeats: g.groupSize,
    totalLuggage: g.luggageCount,
    deadline: g.deadline,
    lat: g.lat,
    lng: g.lng,
    destLat: g.drop?.lat ?? g.lat,
    destLng: g.drop?.lng ?? g.lng,
    destLabel: g.drop?.label ?? "Destination TBC",
    accommodationId: g.accommodationId,
    priority: g.priority,
  };
}
