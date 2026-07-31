import { Router } from "express";
import { z } from "zod";
import { prisma, GuestStatus, RequestStatus, TripStatus, TripType, DriverStatus } from "@baraat/db";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { eta } from "@baraat/maps";

export const adminRouter: Router = Router();
adminRouter.use(requireAuth, requireRole("ADMIN"));

/** Full operational dashboard: every driver + every guest, live. */
adminRouter.get("/overview", async (_req, res) => {
  const [drivers, guests, pendingRequests, activeTrips] = await Promise.all([
    prisma.driver.findMany({
      include: { user: { select: { name: true, phone: true } } },
    }),
    prisma.guest.findMany({
      include: {
        user: { select: { name: true, phone: true } },
        accommodation: { select: { name: true } },
      },
    }),
    prisma.rideRequest.findMany({
      where: { status: RequestStatus.PENDING },
      include: { guest: { include: { user: { select: { name: true } } } } },
    }),
    prisma.trip.findMany({
      where: { status: { in: [TripStatus.ASSIGNED, TripStatus.ACCEPTED, TripStatus.ARRIVED_PICKUP, TripStatus.BOARDED] } },
      include: {
        driver: { include: { user: { select: { name: true } } } },
        tripGuests: { include: { guest: { include: { user: { select: { name: true } } } } } },
      },
    }),
  ]);
  return res.json({
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

/** Upcoming pre-assigned trips + unmatched guests. */
adminRouter.get("/upcoming", async (_req, res) => {
  const [upcoming, unmatched] = await Promise.all([
    prisma.trip.findMany({
      where: { status: TripStatus.ASSIGNED },
      orderBy: { assignedAt: "asc" },
      include: {
        driver: { include: { user: { select: { name: true } } } },
        tripGuests: { include: { guest: { include: { user: { select: { name: true } } } } } },
      },
    }),
    prisma.guest.findMany({
      where: { status: GuestStatus.WAITING },
      orderBy: { waitingSince: "asc" },
      include: { user: { select: { name: true } } },
    }),
  ]);
  return res.json({ upcoming, unmatched });
});

// ---------- On-demand request decisions (manual, human) ----------
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
      // Hand to the engine: mark guest WAITING; the dispatch worker's
      // real-time greedy pass picks it up. Admin never picks the driver.
      await tx.guest.update({
        where: { id: request.guestId },
        data: { status: GuestStatus.WAITING, waitingSince: new Date() },
      });
    }
  });
  return res.json({ ok: true, status });
});

// ---------- Manual override ----------
const overrideSchema = z.object({
  guestId: z.string(),
  driverId: z.string(),
  type: z.enum(["ARRIVAL", "TO_VENUE", "RETURN", "DEPARTURE", "ON_DEMAND"]).default("ON_DEMAND"),
  destLat: z.number(),
  destLng: z.number(),
  destLabel: z.string().optional(),
});

/**
 * Edge-case escape hatch: priority guest, breakdown, no feasible auto-match.
 * Creates a trip directly, bypassing the engine — always available even if
 * the engine is down (reliability NFR).
 */
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

/** Cancel a trip (breakdown etc.) — guests re-queue automatically. */
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

/** Flag / unflag a priority guest (bumps them in the queue). */
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
