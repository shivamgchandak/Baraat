import { Router } from "express";
import { prisma, TripStatus } from "@baraat/db";
import { routeLeg } from "@baraat/maps";
import { requireAuth } from "../middleware/auth.js";

export const tripsRouter: Router = Router();
tripsRouter.use(requireAuth);

tripsRouter.get("/:tripId/route", async (req, res) => {
  const trip = await prisma.trip.findUnique({
    where: { id: req.params.tripId! },
    include: { driver: true, tripGuests: { include: { guest: true } } },
  });
  if (!trip) return res.status(404).json({ error: "Trip not found" });

  const auth = req.auth!;
  const isDriver = auth.driverId && trip.driverId === auth.driverId;
  const isGuest = auth.guestId && trip.tripGuests.some((tg) => tg.guestId === auth.guestId);
  if (auth.role !== "ADMIN" && !isDriver && !isGuest) {
    return res.status(403).json({ error: "Not your trip" });
  }

  const origin = { lat: trip.originLat, lng: trip.originLng };
  const dest = { lat: trip.destLat, lng: trip.destLng };
  const driverPos =
    trip.driver.currentLat != null && trip.driver.currentLng != null
      ? { lat: trip.driver.currentLat, lng: trip.driver.currentLng }
      : null;

  const boarded =
    trip.status === TripStatus.BOARDED || trip.status === TripStatus.ARRIVED_DROP;

  const [toPickup, toDest] = await Promise.all([
    !boarded && driverPos ? routeLeg(driverPos, origin) : Promise.resolve(null),
    boarded && driverPos ? routeLeg(driverPos, dest) : routeLeg(origin, dest),
  ]);

  return res.json({
    tripId: trip.id,
    status: trip.status,
    origin: { ...origin, label: trip.originLabel },
    dest: { ...dest, label: trip.destLabel },
    driver: driverPos,
    toPickup,
    toDest,
  });
});
