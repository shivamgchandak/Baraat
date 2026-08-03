
import { getKv } from "@baraat/kv";
import { ENGINE } from "@baraat/types";
import type { GuestSnapshot } from "./state.js";

const QUEUE_KEY = "dispatch:waitq";
const AGING_FACTOR = 2;
const PRIORITY_BONUS_MS = 60 * 60 * 1000;

export function queueScore(g: GuestSnapshot, now: Date): number {
  const deadline =
    g.deadline?.getTime() ?? now.getTime() + ENGINE.DEFAULT_DEADLINE_MINUTES * 60_000;
  const waitedMs = g.waitingSince ? now.getTime() - g.waitingSince.getTime() : 0;
  return deadline - waitedMs * AGING_FACTOR - (g.priority ? PRIORITY_BONUS_MS : 0);
}

export async function rebuildQueue(guests: GuestSnapshot[], now: Date): Promise<void> {
  const kv = getKv();

  const existing = await kv.zrangeWithScores(QUEUE_KEY, 0, -1);
  const liveIds = new Set(guests.map((g) => g.id));
  for (const e of existing) {
    if (!liveIds.has(e.member)) await kv.zrem(QUEUE_KEY, e.member);
  }
  for (const g of guests) {
    await kv.zadd(QUEUE_KEY, queueScore(g, now), g.id);
  }
}

export async function orderedQueue(guests: GuestSnapshot[], now: Date): Promise<GuestSnapshot[]> {
  await rebuildQueue(guests, now);
  const kv = getKv();
  const entries = await kv.zrangeWithScores(QUEUE_KEY, 0, -1);
  const byId = new Map(guests.map((g) => [g.id, g]));
  return entries.map((e) => byId.get(e.member)).filter((g): g is GuestSnapshot => Boolean(g));
}

export async function removeFromQueue(guestId: string): Promise<void> {
  await getKv().zrem(QUEUE_KEY, guestId);
}
