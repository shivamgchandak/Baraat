import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import type { JwtPayload, RoleName } from "@baraat/types";
import { prisma } from "@baraat/db";

const ACCESS_SECRET = process.env.JWT_SECRET ?? "dev-secret-change-me";
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "dev-refresh-change-me";
const ACCESS_TTL = process.env.ACCESS_TOKEN_TTL ?? "15m";
const REFRESH_TTL_DAYS = 30;

export function signAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: ACCESS_TTL } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, ACCESS_SECRET) as JwtPayload;
}

function hash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function issueRefreshToken(userId: string): Promise<string> {
  const token = jwt.sign({ sub: userId, jti: crypto.randomUUID() }, REFRESH_SECRET, {
    expiresIn: `${REFRESH_TTL_DAYS}d`,
  });
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hash(token),
      expiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 86400_000),
    },
  });
  return token;
}

/** Rotates: verifies, revokes old, issues new pair. */
export async function rotateRefreshToken(
  token: string,
): Promise<{ userId: string; refreshToken: string } | null> {
  try {
    jwt.verify(token, REFRESH_SECRET);
  } catch {
    return null;
  }
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash: hash(token) } });
  if (!row || row.revokedAt || row.expiresAt < new Date()) return null;
  await prisma.refreshToken.update({
    where: { id: row.id },
    data: { revokedAt: new Date() },
  });
  const fresh = await issueRefreshToken(row.userId);
  return { userId: row.userId, refreshToken: fresh };
}

export type { RoleName };
