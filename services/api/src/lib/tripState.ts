
import crypto from "node:crypto";
import { prisma, DriverStatus, GuestStatus, TripStatus, eventPhase } from "@baraat/db";
import { ENGINE } from "@baraat/types";
import { eta } from "@baraat/maps";
import { sendPush } from "@baraat/push";

async function notifyTripGuests(
  tripId: string,
  message: { title: string; body: string },
): Promise<void> {
  const tgs = await prisma.tripGuest.findMany({
    where: { tripId },
    include: { guest: { include: { user: { select: { expoPushToken: true } } } } },
  });
  void sendPush(
    tgs.map((tg) => tg.guest.user.expoPushToken),
    { ...message, data: { tripId } },
  );
}

export class TransitionError extends Error {
  constructor(
    message: string,
    public status = 409,
  ) {
    super(message);
  }
}

const VALID_NEXT: Record<string, TripStatus[]> = {
  ASSIGNED: [TripStatus.ACCEPTED, TripStatus.REJECTED],
  ACCEPTED: [TripStatus.ARRIVED_PICKUP, TripStatus.CANCELLED],
  ARRIVED_PICKUP: [TripStatus.BOARDED, TripStatus.CANCELLED],
  BOARDED: [TripStatus.ARRIVED_DROP],
  ARRIVED_DROP: [TripStatus.COMPLETED],
};

export async function transitionTrip(
  tripId: string,
  driverId: string,
  next: TripStatus,
  opts: { otp?: string } = {},
): Promise<void> {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: { tripGuests: true, driver: true },
  });
  if (!trip) throw new TransitionError("Trip not found", 404);
  if (trip.driverId !== driverId) throw new TransitionError("Not your trip", 403);
  const allowed = VALID_NEXT[trip.status] ?? [];
  if (!allowed.includes(next)) {
    throw new TransitionError(`Cannot go ${trip.status} -> ${next}`);
  }

  if (next === TripStatus.ACCEPTED && trip.eventId) {
    const ev = await prisma.event.findUnique({ where: { id: trip.eventId } });
    const phase = eventPhase(ev);
    if (phase === "closed" || phase === "after") {
      throw new TransitionError("This event has ended — you can't accept new trips");
    }
    if (phase === "before") {
      throw new TransitionError("The event hasn't started yet — you can't accept trips before it begins");
    }
  }

  if (next === TripStatus.BOARDED) {
    if (!trip.boardingOtpHash) {
      throw new TransitionError("Ask the guest to generate their boarding code first", 428);
    }
    const supplied = (opts.otp ?? "").trim();
    const suppliedHash = crypto.createHash("sha256").update(supplied).digest("hex");
    if (suppliedHash !== trip.boardingOtpHash) {
      throw new TransitionError("Incorrect boarding code", 401);
    }
  }

  const now = new Date();
  const guestIds = trip.tripGuests.map((tg) => tg.guestId);

  switch (next) {
    case TripStatus.ACCEPTED: {
      const toPickup = await eta(
        { lat: trip.driver.currentLat ?? trip.originLat, lng: trip.driver.currentLng ?? trip.originLng },
        { lat: trip.originLat, lng: trip.originLng },
      );
      const pickupToDrop = await eta(
        { lat: trip.originLat, lng: trip.originLng },
        { lat: trip.destLat, lng: trip.destLng },
      );
      await prisma.$transaction([
        prisma.trip.update({
          where: { id: tripId },
          data: { status: next, acceptedAt: now, etaSeconds: toPickup.seconds },
        }),
        prisma.driver.update({
          where: { id: driverId },
          data: {
            status: DriverStatus.EN_ROUTE_PICKUP,
            predictedFreeAt: new Date(
              now.getTime() + (toPickup.seconds + pickupToDrop.seconds) * 1000,
            ),
            predictedFreeLat: trip.destLat,
            predictedFreeLng: trip.destLng,
          },
        }),
      ]);
      void notifyTripGuests(tripId, {
        title: "Your driver is on the way 🚘",
        body: `Arriving in about ${Math.max(1, Math.round(toPickup.seconds / 60))} min.`,
      });
      break;
    }
    case TripStatus.REJECTED: {

      await prisma.$transaction([
        prisma.trip.update({ where: { id: tripId }, data: { status: next } }),
        prisma.guest.updateMany({
          where: { id: { in: guestIds } },
          data: { status: GuestStatus.WAITING },
        }),
        prisma.driver.update({
          where: { id: driverId },
          data: {
            status: DriverStatus.IDLE,
            predictedFreeAt: now,
            predictedFreeLat: trip.driver.currentLat,
            predictedFreeLng: trip.driver.currentLng,
          },
        }),
      ]);
      break;
    }
    case TripStatus.ARRIVED_PICKUP: {
      await prisma.trip.update({
        where: { id: tripId },
        data: { status: next, arrivedPickupAt: now, etaSeconds: 0 },
      });
      void notifyTripGuests(tripId, {
        title: "Your driver has arrived 📍",
        body: "Your car is waiting at the pickup point.",
      });
      break;
    }
    case TripStatus.BOARDED: {
      const toDrop = await eta(
        { lat: trip.originLat, lng: trip.originLng },
        { lat: trip.destLat, lng: trip.destLng },
      );
      await prisma.$transaction([
        prisma.trip.update({ where: { id: tripId }, data: { status: next, boardedAt: now } }),
        prisma.guest.updateMany({
          where: { id: { in: guestIds } },
          data: { status: GuestStatus.IN_TRANSIT },
        }),
        prisma.driver.update({
          where: { id: driverId },
          data: {
            status: DriverStatus.OCCUPIED,
            predictedFreeAt: new Date(now.getTime() + toDrop.seconds * 1000),
            predictedFreeLat: trip.destLat,
            predictedFreeLng: trip.destLng,
          },
        }),
      ]);
      break;
    }
    case TripStatus.ARRIVED_DROP: {
      await prisma.trip.update({
        where: { id: tripId },
        data: { status: next, arrivedDropAt: now },
      });

      await completeTrip(tripId, driverId, now);
      break;
    }
    default:
      throw new TransitionError(`Unsupported transition ${next}`);
  }
}

async function completeTrip(tripId: string, driverId: string, now: Date): Promise<void> {
  const trip = await prisma.trip.findUniqueOrThrow({
    where: { id: tripId },
    include: { tripGuests: true, driver: true },
  });
  const guestIds = trip.tripGuests.map((tg) => tg.guestId);
  const tripsDone = trip.driver.tripsSinceBreak + 1;
  const needsBreak = tripsDone >= ENGINE.MAX_TRIPS_BEFORE_BREAK;

  await prisma.$transaction([
    prisma.trip.update({
      where: { id: tripId },
      data: { status: TripStatus.COMPLETED, completedAt: now },
    }),
    prisma.guest.updateMany({
      where: { id: { in: guestIds } },
      data: { status: GuestStatus.COMPLETED },
    }),
    prisma.driver.update({
      where: { id: driverId },
      data: {
        status: needsBreak ? DriverStatus.ON_BREAK : DriverStatus.IDLE,
        tripsSinceBreak: needsBreak ? 0 : tripsDone,
        lastBreakAt: needsBreak ? now : trip.driver.lastBreakAt,
        currentLat: trip.destLat,
        currentLng: trip.destLng,
        lastLocationAt: now,
        predictedFreeAt: needsBreak
          ? new Date(now.getTime() + ENGINE.BREAK_MINUTES * 60_000)
          : now,
        predictedFreeLat: trip.destLat,
        predictedFreeLng: trip.destLng,
      },
    }),
  ]);
}
