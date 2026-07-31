import type { Prisma, PrismaClient } from "./generated/client.js";
import { prisma } from "./index.js";

export type AppRole = "ADMIN" | "DRIVER" | "GUEST";

/**
 * Runs `fn` inside a transaction with the RLS context set, so Postgres
 * policies (sql/rls.sql) apply. Used by the API for DRIVER/GUEST scoped
 * requests — a driver's queries physically cannot see other drivers' rows.
 * System processes (dispatch worker) skip this and run with full access.
 */
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
