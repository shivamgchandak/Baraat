/**
 * Seed: one event in Delhi (venue in Saket — hello, Bride Side!),
 * IGI Airport + NDLS as arrival points, 3 accommodations, 1 admin,
 * 8 drivers (mixed fleet incl. a 12-seat Tempo Traveller), 20 guests
 * with known arrival times.
 *
 * All passwords: password123
 */
import bcrypt from "bcryptjs";
import { prisma, DriverStatus, GuestStatus, Role } from "../src/index.js";

const VENUE = { name: "The Grand Pavilion, Saket", lat: 28.5245, lng: 77.2066 };
const AIRPORT = { name: "IGI Airport T3", lat: 28.5562, lng: 77.1 };
const STATION = { name: "New Delhi Railway Station", lat: 28.6428, lng: 77.2197 };
const HOTELS = [
  { name: "Saket Residency", lat: 28.5286, lng: 77.219 },
  { name: "Hauz Khas Suites", lat: 28.5494, lng: 77.2001 },
  { name: "GK Palace Hotel", lat: 28.5355, lng: 77.242 },
];

const FLEET: { vehicle: string; seats: number; luggage: number; at: { lat: number; lng: number } }[] = [
  { vehicle: "DL1RT1001", seats: 4, luggage: 4, at: VENUE },
  { vehicle: "DL1RT1002", seats: 4, luggage: 4, at: HOTELS[0]! },
  { vehicle: "DL1RT1003", seats: 4, luggage: 5, at: AIRPORT },
  { vehicle: "DL1RT1004", seats: 6, luggage: 8, at: HOTELS[1]! },
  { vehicle: "DL1RT1005", seats: 6, luggage: 8, at: AIRPORT },
  { vehicle: "DL1RT1006", seats: 7, luggage: 10, at: VENUE },
  { vehicle: "DL1RT1007", seats: 7, luggage: 10, at: HOTELS[2]! },
  { vehicle: "DL1RT1008", seats: 12, luggage: 16, at: AIRPORT }, // Tempo Traveller
];

async function main() {
  console.log("Clearing existing data...");
  await prisma.$transaction([
    prisma.tripGuest.deleteMany(),
    prisma.trip.deleteMany(),
    prisma.rideRequest.deleteMany(),
    prisma.refreshToken.deleteMany(),
    prisma.guest.deleteMany(),
    prisma.driver.deleteMany(),
    prisma.accommodation.deleteMany(),
    prisma.eventLocation.deleteMany(),
    prisma.user.deleteMany(),
  ]);

  const hash = await bcrypt.hash("password123", 10);

  console.log("Creating locations...");
  await prisma.eventLocation.createMany({
    data: [
      { ...VENUE, kind: "VENUE" },
      { ...AIRPORT, kind: "AIRPORT" },
      { ...STATION, kind: "STATION" },
    ],
  });
  const hotels = await Promise.all(
    HOTELS.map((h) => prisma.accommodation.create({ data: h })),
  );

  console.log("Creating admin...");
  await prisma.user.create({
    data: {
      name: "Ops Admin",
      email: "admin@baraat.events",
      passwordHash: hash,
      role: Role.ADMIN,
    },
  });

  console.log("Creating drivers...");
  for (let i = 0; i < FLEET.length; i++) {
    const f = FLEET[i]!;
    await prisma.user.create({
      data: {
        name: `Driver ${i + 1}`,
        email: `driver${i + 1}@baraat.events`,
        phone: `+91-98${String(10000000 + i).slice(0, 8)}`,
        passwordHash: hash,
        role: Role.DRIVER,
        driver: {
          create: {
            vehicleNumber: f.vehicle,
            seatCapacity: f.seats,
            luggageCapacity: f.luggage,
            status: DriverStatus.IDLE,
            currentLat: f.at.lat,
            currentLng: f.at.lng,
            lastLocationAt: new Date(),
            predictedFreeAt: new Date(),
            predictedFreeLat: f.at.lat,
            predictedFreeLng: f.at.lng,
          },
        },
      },
    });
  }

  console.log("Creating 20 pre-registered guests (known arrivals)...");
  const now = Date.now();
  for (let i = 0; i < 20; i++) {
    const fromAirport = i % 3 !== 2; // 2/3 arrive by air, 1/3 by train
    const origin = fromAirport ? AIRPORT : STATION;
    const eta = new Date(now + (10 + i * 6) * 60_000); // staggered over ~2h
    const hotel = hotels[i % hotels.length]!;
    const groupSize = [1, 1, 2, 2, 1, 3, 1, 2, 4, 1][i % 10]!;
    await prisma.user.create({
      data: {
        name: `Guest ${i + 1}`,
        email: `guest${i + 1}@example.com`,
        passwordHash: hash,
        role: Role.GUEST,
        guest: {
          create: {
            pickupLat: origin.lat,
            pickupLng: origin.lng,
            pickupLabel: origin.name,
            accommodationId: hotel.id,
            flightTrainEta: eta,
            groupSize,
            luggageCount: groupSize + (i % 2),
            status: GuestStatus.WAITING,
            waitingSince: eta,
            deadline: new Date(eta.getTime() + 45 * 60_000),
            priority: i === 4, // one VIP
          },
        },
      },
    });
  }

  console.log("Seed complete.");
  console.log("  admin@baraat.events / password123");
  console.log("  driver1..8@baraat.events / password123");
  console.log("  guest1..20@example.com / password123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
