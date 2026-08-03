
import { prisma, DriverStatus, GuestStatus, TripStatus } from "@baraat/db";

export interface DriverSnapshot {
  id: string;
  name: string;
  seatCapacity: number;
  luggageCapacity: number;
  status: DriverStatus;
  lat: number | null;
  lng: number | null;
  predictedFreeAt: Date | null;
  predictedFreeLat: number | null;
  predictedFreeLng: number | null;

  seatsInUse: number;
  luggageInUse: number;
  activeTripId: string | null;
  activeTripStatus: TripStatus | null;
}

export interface GuestSnapshot {
  id: string;
  name: string;
  lat: number;
  lng: number;
  pickupLabel: string | null;
  groupSize: number;
  luggageCount: number;
  deadline: Date | null;
  waitingSince: Date | null;
  priority: boolean;
  accommodationId: string | null;
  accommodation: { name: string; lat: number; lng: number } | null;

  drop: { label: string; lat: number; lng: number } | null;
  flightTrainEta: Date | null;
}

export async function loadDrivers(): Promise<DriverSnapshot[]> {
  const drivers = await prisma.driver.findMany({
    where: { status: { not: DriverStatus.OFFLINE } },
    include: {
      user: { select: { name: true } },
      trips: {
        where: {
          status: {
            in: [TripStatus.ASSIGNED, TripStatus.ACCEPTED, TripStatus.ARRIVED_PICKUP, TripStatus.BOARDED],
          },
        },
        include: { tripGuests: { include: { guest: true } } },
      },
    },
  });
  return drivers.map((d) => {
    const active = d.trips[0] ?? null;
    const seatsInUse =
      d.trips.flatMap((t) => t.tripGuests).reduce((a, tg) => a + tg.guest.groupSize, 0) ?? 0;
    const luggageInUse =
      d.trips.flatMap((t) => t.tripGuests).reduce((a, tg) => a + tg.guest.luggageCount, 0) ?? 0;
    return {
      id: d.id,
      name: d.user.name,
      seatCapacity: d.seatCapacity,
      luggageCapacity: d.luggageCapacity,
      status: d.status,
      lat: d.currentLat,
      lng: d.currentLng,
      predictedFreeAt: d.predictedFreeAt,
      predictedFreeLat: d.predictedFreeLat,
      predictedFreeLng: d.predictedFreeLng,
      seatsInUse,
      luggageInUse,
      activeTripId: active?.id ?? null,
      activeTripStatus: active?.status ?? null,
    };
  });
}

export async function loadWaitingGuests(): Promise<GuestSnapshot[]> {
  const { getLiveEventId } = await import("@baraat/db");

  const eventId = await getLiveEventId();
  if (!eventId) return [];
  const guests = await prisma.guest.findMany({
    where: {
      eventId,
      status: GuestStatus.WAITING,

      waitingSince: { not: null },
      pickupLat: { not: null },
      pickupLng: { not: null },
    },
    include: {
      user: { select: { name: true } },
      accommodation: true,
    },
  });
  return guests.map((g) => ({
    id: g.id,
    name: g.user.name,
    lat: g.pickupLat!,
    lng: g.pickupLng!,
    pickupLabel: g.pickupLabel,
    groupSize: g.groupSize,
    luggageCount: g.luggageCount,
    deadline: g.deadline,
    waitingSince: g.waitingSince,
    priority: g.priority,
    accommodationId: g.accommodationId,
    accommodation: g.accommodation
      ? { name: g.accommodation.name, lat: g.accommodation.lat, lng: g.accommodation.lng }
      : null,
    drop:
      g.dropLat != null && g.dropLng != null
        ? { label: g.dropLabel ?? "Drop-off", lat: g.dropLat, lng: g.dropLng }
        : g.accommodation
          ? { label: g.accommodation.name, lat: g.accommodation.lat, lng: g.accommodation.lng }
          : null,
    flightTrainEta: g.flightTrainEta,
  }));
}
