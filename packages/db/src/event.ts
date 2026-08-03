import { prisma } from "./index.js";

export async function getActiveEvent() {
  return prisma.event.findFirst({
    where: { status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
  });
}

export async function getActiveEventId(): Promise<string | null> {
  const e = await getActiveEvent();
  return e?.id ?? null;
}

export type EventPhase = "none" | "before" | "live" | "after" | "closed";

export function eventPhase(
  event: { status: string; startsAt: Date | null; endsAt: Date | null } | null,
  now: Date = new Date(),
): EventPhase {
  if (!event) return "none";
  if (event.status === "CLOSED") return "closed";
  if (event.startsAt && now < event.startsAt) return "before";
  if (event.endsAt && now > event.endsAt) return "after";
  return "live";
}

export async function getLiveEvent() {
  const e = await getActiveEvent();
  return eventPhase(e) === "live" ? e : null;
}

export async function getLiveEventId(): Promise<string | null> {
  const e = await getLiveEvent();
  return e?.id ?? null;
}
