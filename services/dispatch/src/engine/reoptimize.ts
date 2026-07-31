/**
 * Continuous re-optimization under live traffic.
 *
 * Rules (anti-thrash by design):
 *  - refresh ETAs for active trips; persist only if changed materially
 *    (> REOPT_THRESHOLD_SECONDS);
 *  - NEVER reassign in-progress trips (ACCEPTED and beyond) — passengers
 *    are not ping-ponged between cars;
 *  - a not-yet-accepted ASSIGNED trip whose refreshed ETA now breaks the
 *    guest's deadline is cancelled and the guests re-queued (they keep
 *    their original waitingSince, so aging protects them).
 */
import { prisma, DriverStatus, GuestStatus, TripStatus } from "@baraat/db";
import { ENGINE } from "@baraat/types";
import { eta } from "@baraat/maps";

export async function reoptimize(): Promise<{ etaUpdates: number; requeued: number }> {
  const active = await prisma.trip.findMany({
    where: {
      status: { in: [TripStatus.ASSIGNED, TripStatus.ACCEPTED, TripStatus.ARRIVED_PICKUP, TripStatus.BOARDED] },
    },
    include: { driver: true, tripGuests: true },
  });

  let etaUpdates = 0;
  let requeued = 0;
  const now = Date.now();

  for (const trip of active) {
    const from = {
      lat: trip.driver.currentLat ?? trip.originLat,
      lng: trip.driver.currentLng ?? trip.originLng,
    };
    const target =
      trip.status === TripStatus.BOARDED
        ? { lat: trip.destLat, lng: trip.destLng }
        : { lat: trip.originLat, lng: trip.originLng };
    const fresh = await eta(from, target);

    const drift = Math.abs((trip.etaSeconds ?? 0) - fresh.seconds);
    if (drift > ENGINE.REOPT_THRESHOLD_SECONDS) {
      await prisma.trip.update({
        where: { id: trip.id },
        data: { etaSeconds: fresh.seconds },
      });
      etaUpdates++;
    }

    // Deadline breach on a not-yet-started trip -> cancel + re-queue.
    if (
      trip.status === TripStatus.ASSIGNED &&
      trip.deadline &&
      now + fresh.seconds * 1000 > trip.deadline.getTime() + 5 * 60_000
    ) {
      await prisma.$transaction([
        prisma.trip.update({ where: { id: trip.id }, data: { status: TripStatus.CANCELLED } }),
        prisma.guest.updateMany({
          where: { id: { in: trip.tripGuests.map((tg) => tg.guestId) } },
          data: { status: GuestStatus.WAITING },
        }),
        prisma.driver.update({
          where: { id: trip.driverId },
          data: { status: DriverStatus.IDLE, predictedFreeAt: new Date() },
        }),
      ]);
      requeued += trip.tripGuests.length;
      console.log(`[REOPT] trip=${trip.id} cancelled (deadline unreachable), guests re-queued`);
    }
  }
  return { etaUpdates, requeued };
}

/** Drivers whose break has finished come back into rotation. */
export async function endFinishedBreaks(): Promise<number> {
  const cutoff = new Date(Date.now() - ENGINE.BREAK_MINUTES * 60_000);
  const res = await prisma.driver.updateMany({
    where: { status: DriverStatus.ON_BREAK, lastBreakAt: { lte: cutoff } },
    data: { status: DriverStatus.IDLE },
  });
  return res.count;
}
