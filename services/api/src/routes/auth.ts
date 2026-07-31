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
  if (user && !user.passwordHash) {
    return res.status(403).json({
      error: "Account not activated yet — use the invitation link sent to your email",
    });
  }
  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash!))) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  const payload = (await buildPayload(user.id))!;
  return res.json({
    accessToken: signAccessToken(payload),
    refreshToken: await issueRefreshToken(user.id),
    user: { id: user.id, name: user.name, role: user.role },
  });
});

/** Validate an invitation token (the activate screen shows who it's for). */
authRouter.get("/invite/:token", async (req, res) => {
  const user = await prisma.user.findUnique({ where: { inviteToken: req.params.token! } });
  if (!user) return res.status(404).json({ error: "Invalid or already-used invitation link" });
  return res.json({ name: user.name, email: user.email });
});

/**
 * First-time activation: guest sets their password via the emailed link.
 * The link is single-use; afterwards they log in with email + password.
 */
authRouter.post("/activate", async (req, res) => {
  const parsed = z
    .object({ token: z.string().min(10), password: z.string().min(8) })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const user = await prisma.user.findUnique({ where: { inviteToken: parsed.data.token } });
  if (!user) return res.status(404).json({ error: "Invalid or already-used invitation link" });
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await bcrypt.hash(parsed.data.password, 10),
      activatedAt: new Date(),
      inviteToken: null, // single-use
    },
  });
  const payload = (await buildPayload(user.id))!;
  return res.json({
    accessToken: signAccessToken(payload),
    refreshToken: await issueRefreshToken(user.id),
    user: { id: user.id, name: user.name, role: user.role, email: user.email },
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
