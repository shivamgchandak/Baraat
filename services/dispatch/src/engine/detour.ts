/**
 * Opportunistic detour insertion — including trips ALREADY IN PROGRESS.
 *
 * For a driver who is EN_ROUTE_PICKUP or OCCUPIED (guest on board):
 *   - use the driver's LIVE position, not the trip origin;
 *   - candidate guest must fit remaining seats + luggage;
 *   - candidate's destination must match the trip's destination area
 *     (same accommodation / within 2km of trip destination);
 *   - splice pickup into the remaining route; accept only if
 *       added time <= MAX_DETOUR_ADDED_SECONDS
 *     AND the trip's existing deadline still holds
 *     AND the new guest's own deadline holds.
 */
import { prisma, DriverStatus, GuestStatus, TripStatus } from "@baraat/db";
import { ENGINE } from "@baraat/types";
import { eta, haversineMeters } from "@baraat/maps";
import type { DriverSnapshot, GuestSnapshot } from "./state.js";

const DEST_MATCH_METERS = 2000;

export interface DetourResult {
  guestId: string;
  driverId: string;
  tripId: string;
  addedSeconds: number;
}

export async function tryDetourInsertion(
  drivers: DriverSnapshot[],
  waiting: GuestSnapshot[],
): Promise<DetourResult[]> {
  const results: DetourResult[] = [];
  const busy = drivers.filter(
    (d) =>
      d.activeTripId !== null &&
      (d.status === DriverStatus.EN_ROUTE_PICKUP || d.status === DriverStatus.OCCUPIED) &&
      d.lat != null &&
      d.lng != null,
  );

  for (const guest of waiting) {
    let best: (DetourResult & { trip: { destLat: number; destLng: number } }) | null = null;

    for (const d of busy) {
      if (d.seatCapacity - d.seatsInUse < guest.groupSize) continue;
      if (d.luggageCapacity - d.luggageInUse < guest.luggageCount) continue;

      const trip = await prisma.trip.findUnique({ where: { id: d.activeTripId! } });
      if (!trip) continue;
      // Only detour BEFORE boarding-complete states make sense for pickup splice:
      const splicable: TripStatus[] = [TripStatus.ACCEPTED, TripStatus.ARRIVED_PICKUP, TripStatus.BOARDED];
      if (!splicable.includes(trip.status)) continue;

      // Destination compatibility: guest heads to (near) the same place.
      const guestDest = guest.accommodation
        ? { lat: guest.accommodation.lat, lng: guest.accommodation.lng }
        : null;
      if (!guestDest) continue;
      if (
        haversineMeters(guestDest, { lat: trip.destLat, lng: trip.destLng }) > DEST_MATCH_METERS
      )
        continue;

      // Route math from LIVE position:
      const live = { lat: d.lat!, lng: d.lng! };
      const tripPickup = { lat: trip.originLat, lng: trip.originLng };
      const tripDest = { lat: trip.destLat, lng: trip.destLng };
      const guestPickup = { lat: guest.lat, lng: guest.lng };

      let originalRemaining: number;
      let withDetour: number;
      let newGuestPickupEta: number;
      if (trip.status === TripStatus.BOARDED) {
        // heading to destination; splice guest pickup before destination
        originalRemaining = (await eta(live, tripDest)).seconds;
        const leg1 = (await eta(live, guestPickup)).seconds;
        const leg2 = (await eta(guestPickup, tripDest)).seconds;
        withDetour = leg1 + leg2;
        newGuestPickupEta = leg1;
      } else {
        // still heading to original pickup; consider guest-first or original-first
        const a1 = (await eta(live, tripPickup)).seconds;
        const a2 = (await eta(tripPickup, guestPickup)).seconds;
        const a3 = (await eta(guestPickup, tripDest)).seconds;
        const b1 = (await eta(live, guestPickup)).seconds;
        const b2 = (await eta(guestPickup, tripPickup)).seconds;
        const b3 = (await eta(tripPickup, tripDest)).seconds;
        originalRemaining = a1 + (await eta(tripPickup, tripDest)).seconds;
        const optionA = a1 + a2 + a3; // original pickup first
        const optionB = b1 + b2 + b3; // new guest first
        if (optionA <= optionB) {
          withDetour = optionA;
          newGuestPickupEta = a1 + a2;
        } else {
          withDetour = optionB;
          newGuestPickupEta = b1;
        }
      }

      const added = withDetour - originalRemaining;
      if (added > ENGINE.MAX_DETOUR_ADDED_SECONDS) continue;

      const now = Date.now();
      // Existing trip deadline must still hold:
      if (trip.deadline && now + withDetour * 1000 > trip.deadline.getTime()) continue;
      // New guest's own deadline must hold:
      if (guest.deadline && now + newGuestPickupEta * 1000 > guest.deadline.getTime()) continue;

      if (!best || added < best.addedSeconds) {
        best = {
          guestId: guest.id,
          driverId: d.id,
          tripId: trip.id,
          addedSeconds: added,
          trip: { destLat: trip.destLat, destLng: trip.destLng },
        };
      }
    }

    if (best) {
      await prisma.$transaction(async (tx) => {
        await tx.tripGuest.create({ data: { tripId: best!.tripId, guestId: guest.id } });
        await tx.guest.update({
          where: { id: guest.id },
          data: { status: GuestStatus.ASSIGNED },
        });
        const t = await tx.trip.findUniqueOrThrow({ where: { id: best!.tripId } });
        const route = (t.plannedRoute as any) ?? { stops: [] };
        route.stops = [
          { kind: "PICKUP", guestId: guest.id, lat: guest.lat, lng: guest.lng, label: guest.pickupLabel },
          ...route.stops,
        ];
        route.computedAt = new Date().toISOString();
        await tx.trip.update({ where: { id: best!.tripId }, data: { plannedRoute: route } });
      });
      const d = busy.find((x) => x.id === best!.driverId)!;
      d.seatsInUse += guest.groupSize;
      d.luggageInUse += guest.luggageCount;
      console.log(
        `[DETOUR] guest=${guest.name} spliced into trip=${best.tripId} (driver=${best.driverId}) +${Math.round(best.addedSeconds / 60)}m`,
      );
      results.push({ guestId: best.guestId, driverId: best.driverId, tripId: best.tripId, addedSeconds: best.addedSeconds });
    }
  }
  return results;
}
