import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { z } from "zod";
import { prisma, GuestStatus, Role, TripStatus } from "@baraat/db";
import { withRls } from "@baraat/db/src/rls.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { sendInviteEmail } from "../lib/mailer.js";

export const guestsRouter: Router = Router();
guestsRouter.use(requireAuth);

// ---------- ADMIN: register / manually update guests ----------
const guestDetails = {
  pickupLat: z.number().optional(),
  pickupLng: z.number().optional(),
  pickupLabel: z.string().optional(),
  accommodationId: z.string().optional(),
  flightTrainEta: z.coerce.date().optional(),
  groupSize: z.number().int().min(1).max(30).optional(),
  luggageCount: z.number().int().min(0).max(60).optional(),
  deadline: z.coerce.date().optional(),
  priority: z.boolean().optional(),
};

const createGuestSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  /** Optional: when omitted, the guest gets an invitation link and sets
   *  their own password on first login (the normal flow). */
  password: z.string().min(8).optional(),
  ...guestDetails,
});

guestsRouter.post("/", requireRole("ADMIN"), async (req, res) => {
  const parsed = createGuestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { name, email, phone, password, ...details } = parsed.data;
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: "Email already registered" });

  const inviteToken = password ? null : crypto.randomBytes(24).toString("base64url");
  const user = await prisma.user.create({
    data: {
      name,
      email,
      phone,
      passwordHash: password ? await bcrypt.hash(password, 10) : null,
      role: Role.GUEST,
      inviteToken,
      invitedAt: inviteToken ? new Date() : null,
      activatedAt: password ? new Date() : null,
      guest: { create: { ...details } },
    },
    include: { guest: true },
  });

  let inviteLink: string | null = null;
  let emailSent = false;
  if (inviteToken) {
    const origin = process.env.PORTAL_ORIGIN ?? "http://localhost:3000";
    inviteLink = `${origin}/activate?token=${inviteToken}`;
    emailSent = (await sendInviteEmail({ to: email, name, inviteLink })).sent;
  }
  return res.status(201).json({ id: user.guest!.id, userId: user.id, inviteLink, emailSent });
});

/** Re-issue an invitation (guest lost the email / link expired-by-use). */
guestsRouter.post("/:guestId/reinvite", requireRole("ADMIN"), async (req, res) => {
  const guest = await prisma.guest.findUnique({
    where: { id: req.params.guestId! },
    include: { user: true },
  });
  if (!guest) return res.status(404).json({ error: "Guest not found" });
  if (guest.user.activatedAt) {
    return res.status(409).json({ error: "Guest already activated their account" });
  }
  const inviteToken = crypto.randomBytes(24).toString("base64url");
  await prisma.user.update({
    where: { id: guest.userId },
    data: { inviteToken, invitedAt: new Date() },
  });
  const origin = process.env.PORTAL_ORIGIN ?? "http://localhost:3000";
  const inviteLink = `${origin}/activate?token=${inviteToken}`;
  const { sent } = await sendInviteEmail({
    to: guest.user.email,
    name: guest.user.name,
    inviteLink,
  });
  return res.json({ inviteLink, emailSent: sent });
});

/** Manual correction: walk-ins, changed flights — admin edits the record. */
guestsRouter.patch("/:guestId", requireRole("ADMIN"), async (req, res) => {
  const parsed = z.object(guestDetails).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.guest.findUnique({ where: { id: req.params.guestId! } });
  if (!existing) {
    return res.status(404).json({ error: "Guest not found — use the guest id, not the user id" });
  }
  const guest = await prisma.guest.update({
    where: { id: existing.id },
    data: parsed.data,
  });
  return res.json(guest);
});

guestsRouter.get("/", requireRole("ADMIN"), async (_req, res) => {
  const guests = await prisma.guest.findMany({
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

// ---------- GUEST: own record (RLS-scoped) ----------
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

/**
 * Guest's current ride: driver name, vehicle number, live location + ETA.
 * The guest never sees the driver pool — only the assigned match.
 */
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

// ---------- GUEST: on-demand ride request ----------
guestsRouter.post("/me/requests", requireRole("GUEST"), async (req, res) => {
  const parsed = z
    .object({
      note: z.string().max(500).optional(),
      // Optional live pickup (guest app "use my current location" — Phase 3):
      pickupLat: z.number().optional(),
      pickupLng: z.number().optional(),
      pickupLabel: z.string().max(200).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  // Event over -> no new guest requests (admin/driver wrap-up unaffected).
  const event = await prisma.eventState.findUnique({ where: { id: "event" } });
  if (event?.status === "CLOSED") {
    return res.status(409).json({ error: "This event has ended — ride requests are closed" });
  }

  const open = await prisma.rideRequest.findFirst({
    where: { guestId: req.auth!.guestId!, status: "PENDING" },
  });
  if (open) return res.status(409).json({ error: "You already have a pending request" });

  const { note, pickupLat, pickupLng, pickupLabel } = parsed.data;
  const request = await withRls(req.auth!.sub, "GUEST", async (tx) => {
    // Live location (if sent) becomes the guest's pickup point.
    if (pickupLat != null && pickupLng != null) {
      await tx.guest.update({
        where: { id: req.auth!.guestId! },
        data: { pickupLat, pickupLng, pickupLabel: pickupLabel ?? "Current location" },
      });
    }
    return tx.rideRequest.create({
      data: { guestId: req.auth!.guestId!, note },
    });
  });
  return res.status(201).json(request); // guest sees "request pending"
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
