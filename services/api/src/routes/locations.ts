import { Router } from "express";
import { z } from "zod";
import { prisma } from "@baraat/db";
import { geocode, reverseGeocode } from "@baraat/maps";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const locationsRouter: Router = Router();
locationsRouter.use(requireAuth);

/**
 * Location search for the ops UI: known event places (venue, airport,
 * station, hotels) matched first, then geocoder results. Ops never types
 * coordinates by hand.
 */
locationsRouter.get("/search", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (q.length < 2) return res.json([]);
  const needle = q.toLowerCase();

  const [accommodations, eventLocations] = await Promise.all([
    prisma.accommodation.findMany(),
    prisma.eventLocation.findMany(),
  ]);
  const known = [
    ...eventLocations.map((l) => ({ label: l.name, lat: l.lat, lng: l.lng, kind: l.kind })),
    ...accommodations.map((a) => ({ label: a.name, lat: a.lat, lng: a.lng, kind: "HOTEL" })),
  ].filter((l) => l.label.toLowerCase().includes(needle));

  const external = await geocode(q);
  const externalTagged = external.map((e) => ({ ...e, kind: "SEARCH" }));

  // Known event places first; cap total to keep the dropdown tidy.
  return res.json([...known, ...externalTagged].slice(0, 8));
});

/** Reverse geocode for "use my current location" (portal + guest app). */
locationsRouter.get("/reverse", async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: "lat and lng required" });
  }
  const label = await reverseGeocode(lat, lng);
  return res.json({ label, lat, lng });
});

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
