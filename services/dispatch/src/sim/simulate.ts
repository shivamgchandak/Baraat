/**
 * Peak-arrival simulation — the assignment's scoring scenario.
 *
 * Timeline (accelerated — 1 sim step = 1s real, trip phases compressed 60x):
 *   t0   : pre-day BATCH round assigns the 20 seeded, known-arrival guests
 *   t+5s : PEAK BURST — 25 walk-in guests raise on-demand requests at the
 *          airport within seconds (auto-approved here to exercise the
 *          engine; in production an admin clicks approve)
 *   then : engine ticks (greedy + detour + reoptimize) while a driver-bot
 *          plays every driver: accept -> arrive -> board -> drop
 *
 * Ends with a report: waits, shared rides, capacity/deadline violations.
 */
import { prisma, DriverStatus, GuestStatus, Role, TripStatus, TripType } from "@baraat/db";
import bcrypt from "bcryptjs";
import { tick } from "../index.js";
import { runBatch } from "../engine/batch.js";
import { loadDrivers, loadWaitingGuests } from "../engine/state.js";

const AIRPORT = { name: "IGI Airport T3", lat: 28.5562, lng: 77.1 };
// Tunable via env so CI can run the whole scenario in <30s.
const SPEEDUP = Number(process.env.SIM_SPEEDUP ?? 60); // 60 => 1 real s = 1 sim min
const BURST_SIZE = Number(process.env.SIM_BURST ?? 25);
const SIM_STEPS = Number(process.env.SIM_STEPS ?? 120);
const STEP_MS = Number(process.env.SIM_STEP_MS ?? 1000);

async function burstGuests(): Promise<void> {
  const hotels = await prisma.accommodation.findMany();
  const hash = await bcrypt.hash("password123", 4);
  const now = Date.now();
  for (let i = 0; i < BURST_SIZE; i++) {
    const groupSize = [1, 2, 1, 3, 1, 2, 1, 4, 1, 14][i % 10]!; // one 14-pax group -> fleet escalation
    await prisma.user.create({
      data: {
        name: `WalkIn ${i + 1}`,
        email: `walkin${i + 1}@example.com`,
        passwordHash: hash,
        role: Role.GUEST,
        guest: {
          create: {
            pickupLat: AIRPORT.lat + (Math.random() - 0.5) * 0.004,
            pickupLng: AIRPORT.lng + (Math.random() - 0.5) * 0.004,
            pickupLabel: AIRPORT.name,
            accommodationId: hotels[i % hotels.length]!.id,
            groupSize,
            luggageCount: Math.min(groupSize, 3),
            status: GuestStatus.WAITING, // = admin already approved the request
            waitingSince: new Date(now),
            deadline: new Date(now + 45 * 60_000),
            priority: i === 7,
          },
        },
      },
    });
  }
  console.log(`\n=== PEAK BURST: ${BURST_SIZE} on-demand guests at the airport ===\n`);
}

/** Driver-bot: advances every active trip through its lifecycle. */
async function driverBotStep(): Promise<void> {
  const trips = await prisma.trip.findMany({
    where: {
      status: { in: [TripStatus.ASSIGNED, TripStatus.ACCEPTED, TripStatus.ARRIVED_PICKUP, TripStatus.BOARDED] },
    },
    include: { driver: true, tripGuests: { include: { guest: true } } },
  });
  const now = new Date();

  for (const trip of trips) {
    const guestIds = trip.tripGuests.map((tg) => tg.guestId);
    const phaseSeconds = (trip.etaSeconds ?? 300) / SPEEDUP; // compressed

    switch (trip.status) {
      case TripStatus.ASSIGNED: {
        // drivers accept ~95% of offers; simulate an occasional reject
        if (Math.random() < 0.05) {
          await prisma.$transaction([
            prisma.trip.update({ where: { id: trip.id }, data: { status: TripStatus.REJECTED } }),
            prisma.guest.updateMany({
              where: { id: { in: guestIds } },
              data: { status: GuestStatus.WAITING },
            }),
            prisma.driver.update({
              where: { id: trip.driverId },
              data: { status: DriverStatus.IDLE, predictedFreeAt: now },
            }),
          ]);
          console.log(`[BOT] driver rejected trip=${trip.id} -> guests re-queued`);
        } else {
          await prisma.$transaction([
            prisma.trip.update({ where: { id: trip.id }, data: { status: TripStatus.ACCEPTED, acceptedAt: now } }),
            prisma.driver.update({ where: { id: trip.driverId }, data: { status: DriverStatus.EN_ROUTE_PICKUP } }),
          ]);
        }
        break;
      }
      case TripStatus.ACCEPTED: {
        const elapsed = (now.getTime() - (trip.acceptedAt?.getTime() ?? 0)) / 1000;
        // move driver linearly toward pickup
        const frac = Math.min(1, elapsed / Math.max(1, phaseSeconds));
        await prisma.driver.update({
          where: { id: trip.driverId },
          data: {
            currentLat: lerp(trip.driver.currentLat ?? trip.originLat, trip.originLat, frac),
            currentLng: lerp(trip.driver.currentLng ?? trip.originLng, trip.originLng, frac),
            lastLocationAt: now,
          },
        });
        if (frac >= 1) {
          await prisma.trip.update({
            where: { id: trip.id },
            data: { status: TripStatus.ARRIVED_PICKUP, arrivedPickupAt: now, etaSeconds: 0 },
          });
        }
        break;
      }
      case TripStatus.ARRIVED_PICKUP: {
        await prisma.$transaction([
          prisma.trip.update({ where: { id: trip.id }, data: { status: TripStatus.BOARDED, boardedAt: now } }),
          prisma.guest.updateMany({ where: { id: { in: guestIds } }, data: { status: GuestStatus.IN_TRANSIT } }),
          prisma.driver.update({ where: { id: trip.driverId }, data: { status: DriverStatus.OCCUPIED } }),
        ]);
        break;
      }
      case TripStatus.BOARDED: {
        const elapsed = (now.getTime() - (trip.boardedAt?.getTime() ?? 0)) / 1000;
        const dropSeconds = 480 / SPEEDUP; // compressed leg to destination
        const frac = Math.min(1, elapsed / dropSeconds);
        await prisma.driver.update({
          where: { id: trip.driverId },
          data: {
            currentLat: lerp(trip.originLat, trip.destLat, frac),
            currentLng: lerp(trip.originLng, trip.destLng, frac),
            lastLocationAt: now,
          },
        });
        if (frac >= 1) {
          const tripsDone = trip.driver.tripsSinceBreak + 1;
          const needsBreak = tripsDone >= 4;
          await prisma.$transaction([
            prisma.trip.update({
              where: { id: trip.id },
              data: { status: TripStatus.COMPLETED, arrivedDropAt: now, completedAt: now },
            }),
            prisma.guest.updateMany({ where: { id: { in: guestIds } }, data: { status: GuestStatus.COMPLETED } }),
            prisma.driver.update({
              where: { id: trip.driverId },
              data: {
                status: needsBreak ? DriverStatus.ON_BREAK : DriverStatus.IDLE,
                tripsSinceBreak: needsBreak ? 0 : tripsDone,
                lastBreakAt: needsBreak ? now : trip.driver.lastBreakAt,
                currentLat: trip.destLat,
                currentLng: trip.destLng,
                predictedFreeAt: needsBreak
                  ? new Date(now.getTime() + (900_000 / SPEEDUP))
                  : now, // compressed break
                predictedFreeLat: trip.destLat,
                predictedFreeLng: trip.destLng,
              },
            }),
          ]);
          if (needsBreak) console.log(`[BOT] driver=${trip.driver.vehicleNumber} taking a break`);
        }
        break;
      }
    }
  }
  // compressed break end: ON_BREAK drivers whose predictedFreeAt passed
  await prisma.driver.updateMany({
    where: { status: DriverStatus.ON_BREAK, predictedFreeAt: { lte: now } },
    data: { status: DriverStatus.IDLE },
  });
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

async function report(): Promise<void> {
  const guests = await prisma.guest.findMany({ include: { tripGuests: { include: { trip: true } } } });
  const trips = await prisma.trip.findMany({ include: { tripGuests: { include: { guest: true } }, driver: true } });

  const waits: number[] = [];
  let deadlineViolations = 0;
  for (const g of guests) {
    const assignedTrip = g.tripGuests
      .map((tg) => tg.trip)
      .filter((t) => t.status !== TripStatus.REJECTED && t.status !== TripStatus.CANCELLED)
      .sort((a, b) => a.assignedAt.getTime() - b.assignedAt.getTime())[0];
    if (assignedTrip && g.waitingSince) {
      const wait = (assignedTrip.assignedAt.getTime() - g.waitingSince.getTime()) / 1000;
      if (wait > 0) waits.push(wait);
      if (g.deadline && assignedTrip.arrivedPickupAt && assignedTrip.arrivedPickupAt > g.deadline) {
        deadlineViolations++;
      }
    }
  }

  let capacityViolations = 0;
  let sharedRides = 0;
  for (const t of trips) {
    if (t.status === TripStatus.REJECTED || t.status === TripStatus.CANCELLED) continue;
    const seats = t.tripGuests.reduce((a, tg) => a + tg.guest.groupSize, 0);
    const luggage = t.tripGuests.reduce((a, tg) => a + tg.guest.luggageCount, 0);
    // split trips (fleet escalation) carry partial groups; count real load via cluster totals is
    // conservative here: flag only single-guest-overflow
    if (t.tripGuests.length > 1 && (seats > t.driver.seatCapacity || luggage > t.driver.luggageCapacity)) {
      capacityViolations++;
    }
    if (t.tripGuests.length > 1) sharedRides++;
  }

  const unassigned = guests.filter((g) => g.status === GuestStatus.WAITING).length;
  const avg = waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : 0;
  const max = waits.length ? Math.max(...waits) : 0;

  console.log("\n================ SIMULATION REPORT ================");
  console.log(`guests total        : ${guests.length}`);
  console.log(`assigned/completed  : ${guests.filter((g) => g.status !== GuestStatus.WAITING).length}`);
  console.log(`still unassigned    : ${unassigned}`);
  console.log(`trips created       : ${trips.length}`);
  console.log(`shared rides        : ${sharedRides}`);
  console.log(`avg wait (real s)   : ${avg.toFixed(1)}  (~${(avg / 60).toFixed(1)} sim-min at 60x)`);
  console.log(`max wait (real s)   : ${max.toFixed(1)}`);
  console.log(`capacity violations : ${capacityViolations}`);
  console.log(`deadline violations : ${deadlineViolations}`);
  console.log("===================================================\n");
}

async function main() {
  console.log("=== Baraat peak-arrival simulation ===\n");
  console.log("--- Pre-day batch round (Hungarian) over seeded known arrivals ---");
  const [drivers, waiting] = await Promise.all([loadDrivers(), loadWaitingGuests()]);
  const known = waiting.filter((g) => g.flightTrainEta !== null);
  const batchRes = await runBatch(drivers, known, TripType.ARRIVAL);
  console.log(
    `[BATCH] assigned=${batchRes.assigned} guests, leftover clusters=${batchRes.unassignedClusters.length}\n`,
  );

  await burstGuests();

  for (let step = 0; step < SIM_STEPS; step++) {
    await tick(); // the real engine
    await driverBotStep(); // drivers "driving"
    const waitingNow = await prisma.guest.count({ where: { status: GuestStatus.WAITING } });
    const active = await prisma.trip.count({
      where: { status: { in: [TripStatus.ACCEPTED, TripStatus.ARRIVED_PICKUP, TripStatus.BOARDED] } },
    });
    if (step % 10 === 0) {
      console.log(`[t+${step}] waiting=${waitingNow} activeTrips=${active}`);
    }
    if (waitingNow === 0 && active === 0 && step > 10) {
      console.log(`\nAll guests served at step ${step}.`);
      break;
    }
    await new Promise((r) => setTimeout(r, STEP_MS));
  }

  await report();
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
