import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { z } from "zod";
import { prisma, GuestStatus, Role, TripStatus } from "@baraat/db";
import { withRls } from "@baraat/db/src/rls.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { sendCredentialsEmail } from "../lib/mailer.js";
import { getActiveEvent, eventPhase, serviceWindow } from "@baraat/db";

const DEFAULT_GUEST_PASSWORD = "guest123";

function pickupOutsideWindow(
  event: { startsAt: Date | null; endsAt: Date | null },
  pickupAt: Date | undefined,
): string | null {
  if (!pickupAt) return null;
  const fmt = (d: Date) => d.toLocaleString();
  const { start, end } = serviceWindow(event);
  if (start && pickupAt < start) {
    return `Pickup time must be within the ride window (opens ${fmt(start)})`;
  }
  if (end && pickupAt > end) {
    return `Pickup time must be within the ride window (closes ${fmt(end)})`;
  }
  return null;
}

export const guestsRouter: Router = Router();
guestsRouter.use(requireAuth);

const guestDetails = {
  pickupLat: z.number().optional(),
  pickupLng: z.number().optional(),
  pickupLabel: z.string().optional(),
  dropLat: z.number().optional(),
  dropLng: z.number().optional(),
  dropLabel: z.string().optional(),
  accommodationId: z.string().optional(),
  flightTrainEta: z.coerce.date().optional(),
  pickupAt: z.coerce.date().optional(),
  groupSize: z.number().int().min(1).max(30).optional(),
  luggageCount: z.number().int().min(0).max(60).optional(),
  deadline: z.coerce.date().optional(),
  priority: z.boolean().optional(),
};

const createGuestSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),

  password: z.string().min(8).optional(),
  ...guestDetails,
});

guestsRouter.post("/", requireRole("ADMIN"), async (req, res) => {
  const parsed = createGuestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { name, email, phone, password, ...details } = parsed.data;
  const active = await getActiveEvent();
  if (!active) {
    return res.status(409).json({ error: "Create an event first — no active event" });
  }
  const windowErr = pickupOutsideWindow(active, details.pickupAt);
  if (windowErr) return res.status(400).json({ error: windowErr });

  const plainPassword = password ?? DEFAULT_GUEST_PASSWORD;
  const passwordHash = await bcrypt.hash(plainPassword, 10);
  const queued = details.pickupLat != null && details.pickupLng != null;

  const existing = await prisma.user.findUnique({
    where: { email },
    include: { guest: true },
  });
  if (existing) {
    if (existing.role !== Role.GUEST || !existing.guest) {
      return res.status(409).json({ error: "That email is already used by another account" });
    }
    if (existing.guest.eventId === active.id) {
      return res.status(409).json({ error: "This guest is already in the current event" });
    }
    await prisma.guest.update({
      where: { id: existing.guest.id },
      data: {
        ...details,
        eventId: active.id,
        status: GuestStatus.WAITING,
        waitingSince: queued ? (details.pickupAt ?? new Date()) : null,
      },
    });
    await prisma.user.update({
      where: { id: existing.id },
      data: { name, phone, passwordHash },
    });
    const { sent } = await sendCredentialsEmail({ to: email, name, role: "guest", password: plainPassword });
    return res.status(201).json({
      id: existing.guest.id,
      userId: existing.id,
      defaultPassword: password ? null : DEFAULT_GUEST_PASSWORD,
      emailSent: sent,
      reused: true,
    });
  }

  const user = await prisma.user.create({
    data: {
      name,
      email,
      phone,
      passwordHash,
      role: Role.GUEST,
      activatedAt: new Date(),
      guest: {
        create: {
          ...details,
          eventId: active.id,
          waitingSince: queued ? (details.pickupAt ?? new Date()) : null,
        },
      },
    },
    include: { guest: true },
  });

  const { sent } = await sendCredentialsEmail({ to: email, name, role: "guest", password: plainPassword });
  return res.status(201).json({
    id: user.guest!.id,
    userId: user.id,
    defaultPassword: password ? null : DEFAULT_GUEST_PASSWORD,
    emailSent: sent,
  });
});

guestsRouter.patch("/:guestId", requireRole("ADMIN"), async (req, res) => {
  const parsed = z.object(guestDetails).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.guest.findUnique({ where: { id: req.params.guestId! } });
  if (!existing) {
    return res.status(404).json({ error: "Guest not found — use the guest id, not the user id" });
  }
  if (parsed.data.pickupAt && existing.eventId) {
    const ev = await prisma.event.findUnique({ where: { id: existing.eventId } });
    if (ev) {
      const windowErr = pickupOutsideWindow(ev, parsed.data.pickupAt);
      if (windowErr) return res.status(400).json({ error: windowErr });
    }
  }
  const guest = await prisma.guest.update({
    where: { id: existing.id },
    data: parsed.data,
  });
  return res.json(guest);
});

guestsRouter.get("/", requireRole("ADMIN"), async (_req, res) => {
  const active = await getActiveEvent();
  if (!active) return res.json([]);
  const guests = await prisma.guest.findMany({
    where: { eventId: active.id },
    include: {
      user: { select: { name: true, email: true, phone: true, activatedAt: true, invitedAt: true } },
      accommodation: true,
      tripGuests: {
        include: { trip: { select: { id: true, status: true, etaSeconds: true, driverId: true } } },
      },
    },
  });
  return res.json(guests);
});

guestsRouter.get("/me/context", requireRole("GUEST"), async (req, res) => {
  const active = await getActiveEvent();
  const guest = await prisma.guest.findUnique({ where: { id: req.auth!.guestId! } });
  const inEvent = Boolean(active && guest && guest.eventId === active.id);
  const [activeRide, pending] = await Promise.all([
    prisma.tripGuest.findFirst({
      where: {
        guestId: req.auth!.guestId!,
        trip: { status: { in: [TripStatus.ASSIGNED, TripStatus.ACCEPTED, TripStatus.ARRIVED_PICKUP, TripStatus.BOARDED] } },
      },
    }),
    prisma.rideRequest.findFirst({ where: { guestId: req.auth!.guestId!, status: "PENDING" } }),
  ]);

  const waitingForDriver =
    !activeRide &&
    guest?.status === GuestStatus.WAITING &&
    guest?.waitingSince != null &&
    guest?.pickupLat != null;
  const phase = inEvent ? eventPhase(active) : "none";
  return res.json({

    eventActive: phase === "live",
    eventPhase: phase,
    eventName: inEvent ? active!.name : null,
    startsAt: inEvent ? active!.startsAt : null,
    endsAt: inEvent ? active!.endsAt : null,
    hasActiveRide: Boolean(activeRide),
    waitingForDriver: Boolean(waitingForDriver),
    hasPendingRequest: Boolean(pending),
  });
});

guestsRouter.get("/me", requireRole("GUEST"), async (req, res) => {
  const me = await withRls(req.auth!.sub, "GUEST", (tx) =>
    tx.guest.findUnique({
      where: { id: req.auth!.guestId! },
      include: {
        user: { select: { name: true, email: true } },
        accommodation: true,
      },
    }),
  );
  if (!me) return res.status(404).json({ error: "Guest not found" });
  return res.json(me);
});

guestsRouter.get("/me/ride", requireRole("GUEST"), async (req, res) => {
  const tg = await withRls(req.auth!.sub, "GUEST", (tx) =>
    tx.tripGuest.findFirst({
      where: {
        guestId: req.auth!.guestId!,
        trip: {
          status: { in: [TripStatus.ASSIGNED, TripStatus.ACCEPTED, TripStatus.ARRIVED_PICKUP, TripStatus.BOARDED] },
        },
      },
      include: {
        trip: {
          include: {
            driver: {
              select: {
                vehicleNumber: true,
                currentLat: true,
                currentLng: true,
                lastLocationAt: true,
                user: { select: { name: true, phone: true } },
              },
            },
          },
        },
      },
    }),
  );
  if (!tg) return res.json(null);
  const t = tg.trip;
  return res.json({
    tripId: t.id,
    status: t.status,
    etaSeconds: t.etaSeconds,
    destLabel: t.destLabel,
    driver: {
      name: t.driver.user.name,
      phone: t.driver.user.phone,
      vehicleNumber: t.driver.vehicleNumber,
      lat: t.driver.currentLat,
      lng: t.driver.currentLng,
      locationAt: t.driver.lastLocationAt,
    },
  });
});

guestsRouter.post("/me/ride/otp", requireRole("GUEST"), async (req, res) => {
  const tg = await prisma.tripGuest.findFirst({
    where: {
      guestId: req.auth!.guestId!,
      trip: { status: TripStatus.ARRIVED_PICKUP },
    },
    include: { trip: true },
  });
  if (!tg) {
    return res.status(409).json({
      error: "You can generate a boarding code once your driver has arrived at pickup",
    });
  }
  const otp = String(Math.floor(1000 + Math.random() * 9000));
  await prisma.trip.update({
    where: { id: tg.tripId },
    data: {
      boardingOtpHash: crypto.createHash("sha256").update(otp).digest("hex"),
      boardingOtpAt: new Date(),
    },
  });
  return res.json({ otp });
});

guestsRouter.post("/me/requests", requireRole("GUEST"), async (req, res) => {
  const parsed = z
    .object({
      note: z.string().max(500).optional(),
      pickupLat: z.number().optional(),
      pickupLng: z.number().optional(),
      pickupLabel: z.string().max(200).optional(),
      dropLat: z.number().optional(),
      dropLng: z.number().optional(),
      dropLabel: z.string().max(200).optional(),
      groupSize: z.number().int().min(1).max(30).optional(),
      luggageCount: z.number().int().min(0).max(60).optional(),
      pickupAt: z.coerce.date().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const active = await getActiveEvent();
  if (!active) {
    return res.status(409).json({ error: "There is no active event right now" });
  }
  const guest = await prisma.guest.findUnique({ where: { id: req.auth!.guestId! } });
  if (!guest || guest.eventId !== active.id) {
    return res.status(409).json({ error: "You are not part of the current event" });
  }
  const phase = eventPhase(active);
  if (phase === "before") {
    return res.status(409).json({
      error: `The event hasn't started yet — rides open on ${active.startsAt?.toLocaleString() ?? "the start date"}`,
    });
  }
  if (phase !== "live") {
    return res.status(409).json({ error: "The event has ended — ride requests are closed" });
  }
  const windowErr = pickupOutsideWindow(active, parsed.data.pickupAt);
  if (windowErr) return res.status(400).json({ error: windowErr });

  const activeRide = await prisma.tripGuest.findFirst({
    where: {
      guestId: req.auth!.guestId!,
      trip: {
        status: { in: [TripStatus.ASSIGNED, TripStatus.ACCEPTED, TripStatus.ARRIVED_PICKUP, TripStatus.BOARDED] },
      },
    },
  });
  if (activeRide) {
    return res.status(409).json({ error: "You already have a ride in progress — please complete it first" });
  }

  if (guest.status === GuestStatus.WAITING && guest.waitingSince != null && guest.pickupLat != null) {
    return res.status(409).json({ error: "You already have an upcoming ride — we're finding you a driver" });
  }

  const open = await prisma.rideRequest.findFirst({
    where: { guestId: req.auth!.guestId!, status: "PENDING" },
  });
  if (open) return res.status(409).json({ error: "You already have a pending request" });

  const { note, pickupLat, pickupLng, pickupLabel, dropLat, dropLng, dropLabel, groupSize, luggageCount, pickupAt } =
    parsed.data;
  const request = await withRls(req.auth!.sub, "GUEST", async (tx) => {
    const patch: Record<string, unknown> = {};
    if (pickupLat != null && pickupLng != null) {
      patch.pickupLat = pickupLat;
      patch.pickupLng = pickupLng;
      patch.pickupLabel = pickupLabel ?? "Current location";
    }
    if (dropLat != null && dropLng != null) {
      patch.dropLat = dropLat;
      patch.dropLng = dropLng;
      patch.dropLabel = dropLabel ?? "Drop-off";
    }
    if (groupSize != null) patch.groupSize = groupSize;
    if (luggageCount != null) patch.luggageCount = luggageCount;
    if (pickupAt != null) patch.pickupAt = pickupAt;
    if (Object.keys(patch).length) {
      await tx.guest.update({ where: { id: req.auth!.guestId! }, data: patch });
    }
    return tx.rideRequest.create({ data: { guestId: req.auth!.guestId!, note } });
  });
  return res.status(201).json(request);
});

guestsRouter.get("/me/history", requireRole("GUEST"), async (req, res) => {
  const rows = await prisma.tripGuest.findMany({
    where: {
      guestId: req.auth!.guestId!,
      trip: { status: { in: [TripStatus.COMPLETED, TripStatus.CANCELLED] } },
    },
    include: {
      trip: {
        include: { driver: { select: { vehicleNumber: true, user: { select: { name: true } } } } },
      },
    },
    orderBy: { trip: { assignedAt: "desc" } },
  });
  return res.json(
    rows.map((r) => ({
      tripId: r.trip.id,
      status: r.trip.status,
      originLabel: r.trip.originLabel,
      destLabel: r.trip.destLabel,
      completedAt: r.trip.completedAt,
      driverName: r.trip.driver.user.name,
      vehicleNumber: r.trip.driver.vehicleNumber,
    })),
  );
});

guestsRouter.get("/me/requests", requireRole("GUEST"), async (req, res) => {
  const requests = await withRls(req.auth!.sub, "GUEST", (tx) =>
    tx.rideRequest.findMany({
      where: { guestId: req.auth!.guestId! },
      orderBy: { requestedAt: "desc" },
    }),
  );
  return res.json(requests);
});
