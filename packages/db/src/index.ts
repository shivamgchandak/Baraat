import { PrismaClient } from "./generated/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

export * from "./generated/client.js";
export * from "./generated/enums.js";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export { getActiveEvent, getActiveEventId, getLiveEvent, getLiveEventId, eventPhase, serviceWindow, RIDE_WINDOW_BUFFER_MS, type EventPhase } from "./event.js";
