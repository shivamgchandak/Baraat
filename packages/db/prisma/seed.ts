import bcrypt from "bcryptjs";
import { prisma, Role } from "../src/index.js";

async function main() {
  console.log("Clearing all data...");
  await prisma.$transaction([
    prisma.tripGuest.deleteMany(),
    prisma.trip.deleteMany(),
    prisma.rideRequest.deleteMany(),
    prisma.refreshToken.deleteMany(),
    prisma.guest.deleteMany(),
    prisma.driver.deleteMany(),
    prisma.accommodation.deleteMany(),
    prisma.eventLocation.deleteMany(),
    prisma.event.deleteMany(),
    prisma.user.deleteMany(),
  ]);

  await prisma.user.create({
    data: {
      name: "Ops Admin",
      email: "admin@baraat.events",
      passwordHash: await bcrypt.hash("password123", 10),
      role: Role.ADMIN,
    },
  });

  console.log("Done. Sign in as:");
  console.log("  admin@baraat.events / password123");
  console.log("Then create an event and add drivers & guests yourself.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
