/**
 * Shared-ride clustering: guests heading to the SAME accommodation whose
 * pickups are close together and whose pickup windows overlap get grouped
 * into one vehicle — if combined seats + luggage fit the fleet's best
 * vehicle. Reduces vehicle-hours during arrival surges.
 */
import { ENGINE } from "@baraat/types";
import { haversineMeters } from "@baraat/maps";
import type { GuestSnapshot } from "./state.js";

export interface Cluster {
  guests: GuestSnapshot[];
  totalSeats: number;
  totalLuggage: number;
  /** earliest member deadline — the cluster inherits the tightest constraint */
  deadline: Date | null;
  lat: number; // representative pickup (first guest)
  lng: number;
  destLat: number;
  destLng: number;
  destLabel: string;
  accommodationId: string | null;
  priority: boolean;
}

const MAX_PICKUP_SPREAD_METERS = 1500;

export function clusterGuests(
  guests: GuestSnapshot[],
  maxSeats: number,
  maxLuggage: number,
): Cluster[] {
  const clusters: Cluster[] = [];
  const windowMs = ENGINE.CLUSTER_WINDOW_MINUTES * 60_000;

  for (const g of guests) {
    if (!g.accommodation) {
      clusters.push(singleton(g));
      continue;
    }
    const fit = clusters.find(
      (c) =>
        c.accommodationId === g.accommodationId &&
        c.totalSeats + g.groupSize <= maxSeats &&
        c.totalLuggage + g.luggageCount <= maxLuggage &&
        haversineMeters({ lat: c.lat, lng: c.lng }, { lat: g.lat, lng: g.lng }) <=
          MAX_PICKUP_SPREAD_METERS &&
        windowsOverlap(c.guests[0]!, g, windowMs),
    );
    if (fit) {
      fit.guests.push(g);
      fit.totalSeats += g.groupSize;
      fit.totalLuggage += g.luggageCount;
      fit.priority = fit.priority || g.priority;
      if (g.deadline && (!fit.deadline || g.deadline < fit.deadline)) fit.deadline = g.deadline;
    } else {
      clusters.push(singleton(g));
    }
  }
  return clusters;
}

function windowsOverlap(a: GuestSnapshot, b: GuestSnapshot, windowMs: number): boolean {
  const ta = a.flightTrainEta?.getTime() ?? a.waitingSince?.getTime();
  const tb = b.flightTrainEta?.getTime() ?? b.waitingSince?.getTime();
  if (ta == null || tb == null) return true; // both already here
  return Math.abs(ta - tb) <= windowMs;
}

function singleton(g: GuestSnapshot): Cluster {
  return {
    guests: [g],
    totalSeats: g.groupSize,
    totalLuggage: g.luggageCount,
    deadline: g.deadline,
    lat: g.lat,
    lng: g.lng,
    destLat: g.accommodation?.lat ?? g.lat,
    destLng: g.accommodation?.lng ?? g.lng,
    destLabel: g.accommodation?.name ?? "Destination TBC",
    accommodationId: g.accommodationId,
    priority: g.priority,
  };
}
