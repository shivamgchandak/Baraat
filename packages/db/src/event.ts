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

/**
 * The ride availability window — exactly the start/end times the admin set on
 * the event. Rides are only allowed between these. Null bounds mean open-ended.
 */
export function serviceWindow(event: { startsAt: Date | null; endsAt: Date | null }): {
  start: Date | null;
  end: Date | null;
} {
  return { start: event.startsAt ?? null, end: event.endsAt ?? null };
}

export function eventPhase(
  event: { status: string; startsAt: Date | null; endsAt: Date | null } | null,
  now: Date = new Date(),
): EventPhase {
  if (!event) return "none";
  if (event.status === "CLOSED") return "closed";
  const { start, end } = serviceWindow(event);
  if (start && now < start) return "before";
  if (end && now > end) return "after";
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
