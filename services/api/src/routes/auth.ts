import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@baraat/db";
import type { JwtPayload } from "@baraat/types";
import { issueRefreshToken, rotateRefreshToken, signAccessToken } from "../lib/jwt.js";

export const authRouter: Router = Router();

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

async function buildPayload(userId: string): Promise<JwtPayload | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { driver: true, guest: true },
  });
  if (!user) return null;
  return {
    sub: user.id,
    role: user.role,
    driverId: user.driver?.id,
    guestId: user.guest?.id,
  };
}

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    include: { driver: true, guest: true },
  });
  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  const payload = (await buildPayload(user.id))!;
  return res.json({
    accessToken: signAccessToken(payload),
    refreshToken: await issueRefreshToken(user.id),
    user: { id: user.id, name: user.name, role: user.role },
  });
});

authRouter.post("/refresh", async (req, res) => {
  const token = z.object({ refreshToken: z.string() }).safeParse(req.body);
  if (!token.success) return res.status(400).json({ error: "refreshToken required" });
  const rotated = await rotateRefreshToken(token.data.refreshToken);
  if (!rotated) return res.status(401).json({ error: "Invalid refresh token" });
  const payload = await buildPayload(rotated.userId);
  if (!payload) return res.status(401).json({ error: "User no longer exists" });
  return res.json({
    accessToken: signAccessToken(payload),
    refreshToken: rotated.refreshToken,
  });
});
