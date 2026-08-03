import type { Prisma, PrismaClient } from "./generated/client.js";
import { prisma } from "./index.js";

export type AppRole = "ADMIN" | "DRIVER" | "GUEST";

export async function withRls<T>(
  userId: string,
  role: AppRole,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `SELECT set_config('app.user_id', '${userId.replace(/'/g, "''")}', true),
              set_config('app.role', '${role}', true)`,
    );
    return fn(tx);
  });
}

export type { PrismaClient };
