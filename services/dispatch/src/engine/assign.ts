/**
 * Persists an engine decision atomically: trip + trip-guests + guest status
 * + driver predicted-free state, all in one transaction. This is why the
 * system runs on ONE database — assignment is a single atomic operation.
 */
import { prisma, DriverStatus, GuestStatus, TripType } from "@baraat/db";
import type { Cluster } from "./clustering.js";
import type { DriverSnapshot } from "./state.js";
import { eta } from "@baraat/maps";

export async function persistAssignment(
  driver: DriverSnapshot,
  cluster: Cluster,
  tripType: TripType,
  reason: "BATCH" | "GREEDY",
): Promise<string> {
  const from =
    driver.status === DriverStatus.IDLE
      ? { lat: driver.lat ?? cluster.lat, lng: driver.lng ?? cluster.lng }
      : {
          lat: driver.predictedFreeLat ?? driver.lat ?? cluster.lat,
          lng: driver.predictedFreeLng ?? driver.lng ?? cluster.lng,
        };
  const toPickup = await eta(from, { lat: cluster.lat, lng: cluster.lng });
  const pickupToDrop = await eta(
    { lat: cluster.lat, lng: cluster.lng },
    { lat: cluster.destLat, lng: cluster.destLng },
  );
  const now = new Date();
  const baseTime =
    driver.status === DriverStatus.IDLE
      ? now.getTime()
      : (driver.predictedFreeAt ?? now).getTime();

  const trip = await prisma.$transaction(async (tx) => {
    const t = await tx.trip.create({
      data: {
        driverId: driver.id,
        type: tripType,
        originLat: cluster.lat,
        originLng: cluster.lng,
        originLabel: cluster.guests[0]!.pickupLabel,
        destLat: cluster.destLat,
        destLng: cluster.destLng,
        destLabel: cluster.destLabel,
        deadline: cluster.deadline,
        etaSeconds: toPickup.seconds,
        assignedBy: "ENGINE",
        plannedRoute: {
          stops: [
            ...cluster.guests.map((g) => ({
              kind: "PICKUP",
              guestId: g.id,
              lat: g.lat,
              lng: g.lng,
              label: g.pickupLabel,
            })),
            ...cluster.guests.map((g) => ({
              kind: "DROP",
              guestId: g.id,
              lat: cluster.destLat,
              lng: cluster.destLng,
              label: cluster.destLabel,
            })),
          ],
          totalSeconds: toPickup.seconds + pickupToDrop.seconds,
          totalMeters: toPickup.meters + pickupToDrop.meters,
          computedAt: now.toISOString(),
        },
        tripGuests: { create: cluster.guests.map((g) => ({ guestId: g.id })) },
      },
    });
    await tx.guest.updateMany({
      where: { id: { in: cluster.guests.map((g) => g.id) } },
      data: { status: GuestStatus.ASSIGNED },
    });
    await tx.driver.update({
      where: { id: driver.id },
      data: {
        predictedFreeAt: new Date(baseTime + (toPickup.seconds + pickupToDrop.seconds) * 1000),
        predictedFreeLat: cluster.destLat,
        predictedFreeLng: cluster.destLng,
      },
    });
    return t;
  });

  console.log(
    `[${reason}] driver=${driver.name} <- guests=[${cluster.guests
      .map((g) => g.name)
      .join(", ")}] seats=${cluster.totalSeats}/${driver.seatCapacity} eta=${Math.round(
      toPickup.seconds / 60,
    )}m dest=${cluster.destLabel}`,
  );
  return trip.id;
}
