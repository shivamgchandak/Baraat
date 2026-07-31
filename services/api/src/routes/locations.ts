import { Router } from "express";
import { z } from "zod";
import { prisma } from "@baraat/db";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const locationsRouter: Router = Router();
locationsRouter.use(requireAuth);

const accommodationSchema = z.object({
  name: z.string().min(1),
  lat: z.number(),
  lng: z.number(),
});

locationsRouter.post("/accommodations", requireRole("ADMIN"), async (req, res) => {
  const parsed = accommodationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const acc = await prisma.accommodation.create({ data: parsed.data });
  return res.status(201).json(acc);
});

locationsRouter.get("/accommodations", async (_req, res) => {
  return res.json(await prisma.accommodation.findMany());
});

const eventLocationSchema = accommodationSchema.extend({
  kind: z.enum(["VENUE", "AIRPORT", "STATION"]),
});

locationsRouter.post("/event-locations", requireRole("ADMIN"), async (req, res) => {
  const parsed = eventLocationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const loc = await prisma.eventLocation.create({ data: parsed.data });
  return res.status(201).json(loc);
});

locationsRouter.get("/event-locations", async (_req, res) => {
  return res.json(await prisma.eventLocation.findMany());
});
