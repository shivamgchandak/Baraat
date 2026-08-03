
import { ENGINE } from "@baraat/types";
import { haversineMeters } from "@baraat/maps";
import type { GuestSnapshot } from "./state.js";

export interface Cluster {
  guests: GuestSnapshot[];
  totalSeats: number;
  totalLuggage: number;

  deadline: Date | null;
  lat: number;
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
    if (!g.drop) {
      clusters.push(singleton(g));
      continue;
    }
    const fit = clusters.find(
      (c) =>

        haversineMeters({ lat: c.destLat, lng: c.destLng }, { lat: g.drop!.lat, lng: g.drop!.lng }) <=
          300 &&
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
  if (ta == null || tb == null) return true;
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
    destLat: g.drop?.lat ?? g.lat,
    destLng: g.drop?.lng ?? g.lng,
    destLabel: g.drop?.label ?? "Destination TBC",
    accommodationId: g.accommodationId,
    priority: g.priority,
  };
}
