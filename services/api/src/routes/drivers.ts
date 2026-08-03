import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma, DriverStatus, Role, TripStatus } from "@baraat/db";
import { withRls } from "@baraat/db/src/rls.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { TransitionError, transitionTrip } from "../lib/tripState.js";
import { sendCredentialsEmail } from "../lib/mailer.js";
import { getActiveEvent } from "@baraat/db";

const DEFAULT_DRIVER_PASSWORD = "driver123";

export const driversRouter: Router = Router();
driversRouter.use(requireAuth);

const createDriverSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  password: z.string().min(8).optional(),
  vehicleNumber: z.string().min(1),
  seatCapacity: z.number().int().min(1).max(20),
  luggageCapacity: z.number().int().min(0).max(40),
});

driversRouter.post("/", requireRole("ADMIN"), async (req, res) => {
  const parsed = createDriverSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const d = parsed.data;
  const active = await getActiveEvent();
  if (!active) {
    return res.status(409).json({ error: "Create an event first — no active event" });
  }
  const plainPassword = d.password ?? DEFAULT_DRIVER_PASSWORD;
  const passwordHash = await bcrypt.hash(plainPassword, 10);

  const existing = await prisma.user.findUnique({
    where: { email: d.email },
    include: { driver: true, guest: true },
  });
  if (existing) {
    if (existing.guest && existing.guest.eventId === active.id) {
      return res.status(409).json({ error: "This person is already a guest in this event — the same person can't be both in one event" });
    }
    if (existing.driver && existing.driver.eventId === active.id) {
      return res.status(409).json({ error: "This driver is already in the current event" });
    }
    const driverData = {
      eventId: active.id,
      vehicleNumber: d.vehicleNumber,
      seatCapacity: d.seatCapacity,
      luggageCapacity: d.luggageCapacity,
      status: DriverStatus.OFFLINE,
      currentLat: null,
      currentLng: null,
      lastLocationAt: null,
      predictedFreeAt: null,
      predictedFreeLat: null,
      predictedFreeLng: null,
      tripsSinceBreak: 0,
      lastBreakAt: null,
    };
    const driver = existing.driver
      ? await prisma.driver.update({ where: { id: existing.driver.id }, data: driverData })
      : await prisma.driver.create({ data: { userId: existing.id, ...driverData } });
    await prisma.user.update({
      where: { id: existing.id },
      data: { role: Role.DRIVER, name: d.name, phone: d.phone, passwordHash },
    });
    const { sent } = await sendCredentialsEmail({ to: d.email, name: d.name, role: "driver", password: plainPassword });
    return res.status(201).json({
      id: driver.id,
      userId: existing.id,
      defaultPassword: d.password ? null : DEFAULT_DRIVER_PASSWORD,
      emailSent: sent,
      reused: true,
    });
  }

  const user = await prisma.user.create({
    data: {
      name: d.name,
      email: d.email,
      phone: d.phone,
      passwordHash,
      role: Role.DRIVER,
      activatedAt: new Date(),
      driver: {
        create: {
          eventId: active.id,
          vehicleNumber: d.vehicleNumber,
          seatCapacity: d.seatCapacity,
          luggageCapacity: d.luggageCapacity,
        },
      },
    },
    include: { driver: true },
  });
  const { sent } = await sendCredentialsEmail({ to: d.email, name: d.name, role: "driver", password: plainPassword });
  return res.status(201).json({
    id: user.driver!.id,
    userId: user.id,
    defaultPassword: d.password ? null : DEFAULT_DRIVER_PASSWORD,
    emailSent: sent,
  });
});

driversRouter.get("/", requireRole("ADMIN"), async (_req, res) => {
  const active = await getActiveEvent();
  if (!active) return res.json([]);
  const drivers = await prisma.driver.findMany({
    where: { eventId: active.id },
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

driversRouter.get("/me/trip", requireRole("DRIVER"), async (req, res) => {
  const active = await getActiveEvent();
  const trip = await withRls(req.auth!.sub, "DRIVER", (tx) =>
    tx.trip.findFirst({
      where: {
        driverId: req.auth!.driverId!,
        eventId: active?.id ?? "__none__",
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
  if (!trip) return res.json(null);

  const { boardingOtpHash, ...safe } = trip as typeof trip & { boardingOtpHash: string | null };
  return res.json({ ...safe, otpReady: Boolean(boardingOtpHash) });
});

driversRouter.get("/me/history", requireRole("DRIVER"), async (req, res) => {
  const active = await getActiveEvent();
  if (!active) return res.json([]);
  const trips = await withRls(req.auth!.sub, "DRIVER", (tx) =>
    tx.trip.findMany({
      where: {
        driverId: req.auth!.driverId!,
        eventId: active.id,
        status: { in: [TripStatus.COMPLETED, TripStatus.CANCELLED] },
      },
      orderBy: { assignedAt: "desc" },
      include: {
        tripGuests: { include: { guest: { include: { user: { select: { name: true } } } } } },
      },
    }),
  );
  return res.json(trips);
});

const statusSchema = z.object({
  status: z.enum(["ACCEPTED", "REJECTED", "ARRIVED_PICKUP", "BOARDED", "ARRIVED_DROP"]),
  otp: z.string().optional(),
});

driversRouter.post("/me/trip/:tripId/status", requireRole("DRIVER"), async (req, res) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    await transitionTrip(
      req.params.tripId!,
      req.auth!.driverId!,
      parsed.data.status as TripStatus,
      { otp: parsed.data.otp },
    );
    return res.json({ ok: true });
  } catch (e) {
    if (e instanceof TransitionError) return res.status(e.status).json({ error: e.message });
    throw e;
  }
});

const locationSchema = z.object({ lat: z.number(), lng: z.number() });

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
