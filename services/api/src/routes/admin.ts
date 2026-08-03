import { Router } from "express";
import { z } from "zod";
import { prisma, GuestStatus, RequestStatus, TripStatus, TripType, DriverStatus, getActiveEvent } from "@baraat/db";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { eta } from "@baraat/maps";

export const adminRouter: Router = Router();
adminRouter.use(requireAuth, requireRole("ADMIN"));

adminRouter.get("/overview", async (_req, res) => {
  const active = await getActiveEvent();
  const eventId = active?.id ?? "__none__";
  const [drivers, guests, pendingRequests, activeTrips] = await Promise.all([
    prisma.driver.findMany({
      include: { user: { select: { name: true, phone: true } } },
    }),
    prisma.guest.findMany({
      where: { eventId },
      include: {
        user: { select: { name: true, phone: true } },
        accommodation: { select: { name: true } },
      },
    }),
    prisma.rideRequest.findMany({
      where: { status: RequestStatus.PENDING, guest: { eventId } },
      include: { guest: { include: { user: { select: { name: true } } } } },
    }),
    prisma.trip.findMany({
      where: {
        eventId,
        status: { in: [TripStatus.ASSIGNED, TripStatus.ACCEPTED, TripStatus.ARRIVED_PICKUP, TripStatus.BOARDED] },
      },
      include: {
        driver: { include: { user: { select: { name: true } } } },
        tripGuests: { include: { guest: { include: { user: { select: { name: true } } } } } },
      },
    }),
  ]);
  return res.json({
    event: active,
    drivers,
    guests: {
      waiting: guests.filter((g) => g.status === GuestStatus.WAITING),
      assigned: guests.filter((g) => g.status === GuestStatus.ASSIGNED),
      inTransit: guests.filter((g) => g.status === GuestStatus.IN_TRANSIT),
      completed: guests.filter((g) => g.status === GuestStatus.COMPLETED),
    },
    pendingRequests,
    activeTrips,
  });
});

adminRouter.get("/upcoming", async (_req, res) => {
  const active = await getActiveEvent();
  const eventId = active?.id ?? "__none__";
  const [upcoming, unmatched] = await Promise.all([
    prisma.trip.findMany({
      where: { eventId, status: TripStatus.ASSIGNED },
      orderBy: { assignedAt: "asc" },
      include: {
        driver: { include: { user: { select: { name: true } } } },
        tripGuests: { include: { guest: { include: { user: { select: { name: true } } } } } },
      },
    }),
    prisma.guest.findMany({
      where: { eventId, status: GuestStatus.WAITING },
      orderBy: { waitingSince: "asc" },
      include: { user: { select: { name: true } } },
    }),
  ]);
  return res.json({ upcoming, unmatched });
});

const decisionSchema = z.object({ decision: z.enum(["APPROVED", "DECLINED"]) });

adminRouter.post("/requests/:requestId/decide", async (req, res) => {
  const parsed = decisionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const request = await prisma.rideRequest.findUnique({
    where: { id: req.params.requestId! },
    include: { guest: true },
  });
  if (!request) return res.status(404).json({ error: "Request not found" });
  if (request.status !== RequestStatus.PENDING) {
    return res.status(409).json({ error: `Already ${request.status}` });
  }
  const status = parsed.data.decision as RequestStatus;
  await prisma.$transaction(async (tx) => {
    await tx.rideRequest.update({
      where: { id: request.id },
      data: { status, decidedByUserId: req.auth!.sub, decidedAt: new Date() },
    });
    if (status === RequestStatus.APPROVED) {

      await tx.guest.update({
        where: { id: request.guestId },
        data: { status: GuestStatus.WAITING, waitingSince: new Date() },
      });
    }
  });
  return res.json({ ok: true, status });
});

const overrideSchema = z.object({
  guestId: z.string(),
  driverId: z.string(),
  type: z.enum(["ARRIVAL", "TO_VENUE", "RETURN", "DEPARTURE", "ON_DEMAND"]).default("ON_DEMAND"),
  destLat: z.number(),
  destLng: z.number(),
  destLabel: z.string().optional(),
});

adminRouter.post("/override/assign", async (req, res) => {
  const parsed = overrideSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { guestId, driverId, type, destLat, destLng, destLabel } = parsed.data;
  const [guest, driver] = await Promise.all([
    prisma.guest.findUnique({ where: { id: guestId } }),
    prisma.driver.findUnique({ where: { id: driverId } }),
  ]);
  if (!guest || !driver) return res.status(404).json({ error: "Guest or driver not found" });
  if (guest.pickupLat == null || guest.pickupLng == null) {
    return res.status(400).json({ error: "Guest has no pickup location" });
  }
  if (guest.groupSize > driver.seatCapacity || guest.luggageCount > driver.luggageCapacity) {
    return res.status(400).json({ error: "Capacity exceeded — pick a bigger vehicle" });
  }
  const toPickup = await eta(
    { lat: driver.currentLat ?? guest.pickupLat, lng: driver.currentLng ?? guest.pickupLng },
    { lat: guest.pickupLat, lng: guest.pickupLng },
  );
  const trip = await prisma.$transaction(async (tx) => {
    const t = await tx.trip.create({
      data: {
        eventId: guest.eventId,
        driverId,
        type: type as TripType,
        originLat: guest.pickupLat!,
        originLng: guest.pickupLng!,
        originLabel: guest.pickupLabel,
        destLat,
        destLng,
        destLabel,
        etaSeconds: toPickup.seconds,
        assignedBy: "ADMIN_OVERRIDE",
        tripGuests: { create: [{ guestId }] },
      },
    });
    await tx.guest.update({ where: { id: guestId }, data: { status: GuestStatus.ASSIGNED } });
    return t;
  });
  return res.status(201).json(trip);
});

adminRouter.post("/override/cancel-trip/:tripId", async (req, res) => {
  const trip = await prisma.trip.findUnique({
    where: { id: req.params.tripId! },
    include: { tripGuests: true },
  });
  if (!trip) return res.status(404).json({ error: "Trip not found" });
  const terminal: TripStatus[] = [TripStatus.COMPLETED, TripStatus.CANCELLED, TripStatus.REJECTED];
  if (terminal.includes(trip.status)) {
    return res.status(409).json({ error: `Trip already ${trip.status}` });
  }
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
  return res.json({ ok: true });
});

adminRouter.get("/event", async (_req, res) => {
  return res.json(await getActiveEvent());
});

adminRouter.get("/events", async (_req, res) => {
  const events = await prisma.event.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    include: {
      _count: { select: { guests: true, trips: true, accommodations: true } },
    },
  });
  return res.json(events);
});

const createEventSchema = z.object({
  name: z.string().min(1),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
  accommodations: z
    .array(z.object({ name: z.string().min(1), lat: z.number(), lng: z.number() }))
    .default([]),
  places: z
    .array(
      z.object({
        name: z.string().min(1),
        kind: z.enum(["VENUE", "AIRPORT", "STATION", "PLACE"]),
        lat: z.number(),
        lng: z.number(),
      }),
    )
    .default([]),
});

adminRouter.post("/events", async (req, res) => {
  const parsed = createEventSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const active = await getActiveEvent();
  if (active) {
    return res.status(409).json({ error: "End the current event before starting a new one" });
  }
  if (parsed.data.startsAt && parsed.data.endsAt && parsed.data.endsAt <= parsed.data.startsAt) {
    return res.status(400).json({ error: "End date must be after the start date" });
  }
  const event = await prisma.event.create({
    data: {
      name: parsed.data.name,
      startsAt: parsed.data.startsAt ?? null,
      endsAt: parsed.data.endsAt ?? null,
    },
  });
  if (parsed.data.accommodations.length) {
    await prisma.accommodation.createMany({
      data: parsed.data.accommodations.map((a) => ({ ...a, eventId: event.id })),
    });
  }
  if (parsed.data.places.length) {
    await prisma.eventLocation.createMany({
      data: parsed.data.places.map((p) => ({ ...p, eventId: event.id })),
    });
  }
  return res.status(201).json(event);
});

adminRouter.post("/events/:id/close", async (req, res) => {
  const event = await prisma.event.findUnique({ where: { id: req.params.id! } });
  if (!event) return res.status(404).json({ error: "Event not found" });
  if (event.status === "CLOSED") return res.status(409).json({ error: "Already closed" });
  const updated = await prisma.event.update({
    where: { id: event.id },
    data: { status: "CLOSED", closedAt: new Date() },
  });
  return res.json(updated);
});

adminRouter.get("/events/:id", async (req, res) => {
  const event = await prisma.event.findUnique({
    where: { id: req.params.id! },
    include: {
      accommodations: true,
      eventLocations: true,
      guests: { include: { user: { select: { name: true, email: true } } } },
      trips: {
        include: {
          driver: { include: { user: { select: { name: true } } } },
          tripGuests: { include: { guest: { include: { user: { select: { name: true } } } } } },
        },
        orderBy: { assignedAt: "desc" },
      },
    },
  });
  if (!event) return res.status(404).json({ error: "Event not found" });
  return res.json(event);
});

adminRouter.post("/override/priority/:guestId", async (req, res) => {
  const parsed = z.object({ priority: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const guest = await prisma.guest.findUnique({ where: { id: req.params.guestId! } });
  if (!guest) return res.status(404).json({ error: "Guest not found" });
  await prisma.guest.update({
    where: { id: guest.id },
    data: { priority: parsed.data.priority },
  });
  return res.json({ ok: true });
});
