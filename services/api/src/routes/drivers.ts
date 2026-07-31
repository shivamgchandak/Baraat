import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma, DriverStatus, Role, TripStatus } from "@baraat/db";
import { withRls } from "@baraat/db/src/rls.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { TransitionError, transitionTrip } from "../lib/tripState.js";

export const driversRouter: Router = Router();
driversRouter.use(requireAuth);

// ---------- ADMIN: manual driver onboarding ----------
const createDriverSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  password: z.string().min(8),
  vehicleNumber: z.string().min(1),
  seatCapacity: z.number().int().min(1).max(20),
  luggageCapacity: z.number().int().min(0).max(40),
});

driversRouter.post("/", requireRole("ADMIN"), async (req, res) => {
  const parsed = createDriverSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const d = parsed.data;
  const existing = await prisma.user.findUnique({ where: { email: d.email } });
  if (existing) return res.status(409).json({ error: "Email already registered" });
  const user = await prisma.user.create({
    data: {
      name: d.name,
      email: d.email,
      phone: d.phone,
      passwordHash: await bcrypt.hash(d.password, 10),
      role: Role.DRIVER,
      driver: {
        create: {
          vehicleNumber: d.vehicleNumber,
          seatCapacity: d.seatCapacity,
          luggageCapacity: d.luggageCapacity,
        },
      },
    },
    include: { driver: true },
  });
  return res.status(201).json({ id: user.driver!.id, userId: user.id });
});

driversRouter.get("/", requireRole("ADMIN"), async (_req, res) => {
  const drivers = await prisma.driver.findMany({
    include: {
      user: { select: { name: true, email: true, phone: true } },
      trips: {
        where: { status: { in: [TripStatus.ASSIGNED, TripStatus.ACCEPTED, TripStatus.ARRIVED_PICKUP, TripStatus.BOARDED] } },
        include: { tripGuests: { include: { guest: { include: { user: { select: { name: true } } } } } } },
      },
    },
  });
  return res.json(drivers);
});

// ---------- DRIVER: own state (RLS-scoped) ----------
driversRouter.get("/me", requireRole("DRIVER"), async (req, res) => {
  const me = await withRls(req.auth!.sub, "DRIVER", (tx) =>
    tx.driver.findUnique({
      where: { id: req.auth!.driverId! },
      include: { user: { select: { name: true, email: true } } },
    }),
  );
  if (!me) return res.status(404).json({ error: "Driver not found" });
  return res.json(me);
});

/** The driver's single current trip — never a queue, never other drivers. */
driversRouter.get("/me/trip", requireRole("DRIVER"), async (req, res) => {
  const trip = await withRls(req.auth!.sub, "DRIVER", (tx) =>
    tx.trip.findFirst({
      where: {
        driverId: req.auth!.driverId!,
        status: { in: [TripStatus.ASSIGNED, TripStatus.ACCEPTED, TripStatus.ARRIVED_PICKUP, TripStatus.BOARDED, TripStatus.ARRIVED_DROP] },
      },
      orderBy: { assignedAt: "asc" },
      include: {
        tripGuests: {
          include: {
            guest: {
              select: {
                id: true,
                groupSize: true,
                luggageCount: true,
                pickupLabel: true,
                user: { select: { name: true, phone: true } },
              },
            },
          },
        },
      },
    }),
  );
  return res.json(trip ?? null);
});

const statusSchema = z.object({
  status: z.enum(["ACCEPTED", "REJECTED", "ARRIVED_PICKUP", "BOARDED", "ARRIVED_DROP"]),
});

driversRouter.post("/me/trip/:tripId/status", requireRole("DRIVER"), async (req, res) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    await transitionTrip(req.params.tripId!, req.auth!.driverId!, parsed.data.status as TripStatus);
    return res.json({ ok: true });
  } catch (e) {
    if (e instanceof TransitionError) return res.status(e.status).json({ error: e.message });
    throw e;
  }
});

const locationSchema = z.object({ lat: z.number(), lng: z.number() });

/** Continuous live location while on a trip. */
driversRouter.post("/me/location", requireRole("DRIVER"), async (req, res) => {
  const parsed = locationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  await prisma.driver.update({
    where: { id: req.auth!.driverId! },
    data: {
      currentLat: parsed.data.lat,
      currentLng: parsed.data.lng,
      lastLocationAt: new Date(),
    },
  });
  return res.json({ ok: true });
});

/** Driver goes online/offline. */
driversRouter.post("/me/presence", requireRole("DRIVER"), async (req, res) => {
  const parsed = z.object({ online: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const driver = await prisma.driver.findUniqueOrThrow({ where: { id: req.auth!.driverId! } });
  if (driver.status !== DriverStatus.OFFLINE && parsed.data.online) {
    return res.json({ ok: true, status: driver.status });
  }
  const status = parsed.data.online ? DriverStatus.IDLE : DriverStatus.OFFLINE;
  await prisma.driver.update({ where: { id: driver.id }, data: { status } });
  return res.json({ ok: true, status });
});
