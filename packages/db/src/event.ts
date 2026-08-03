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

/** Rides open this many ms before the event starts and stay open this long after it ends. */
export const RIDE_WINDOW_BUFFER_MS = 8 * 60 * 60 * 1000;

/**
 * The window during which rides are actually allowed: the event's own window
 * widened by RIDE_WINDOW_BUFFER_MS on each side (so early arrivals and late
 * departures are covered). Null bounds mean open-ended on that side.
 */
export function serviceWindow(event: { startsAt: Date | null; endsAt: Date | null }): {
  start: Date | null;
  end: Date | null;
} {
  return {
    start: event.startsAt ? new Date(event.startsAt.getTime() - RIDE_WINDOW_BUFFER_MS) : null,
    end: event.endsAt ? new Date(event.endsAt.getTime() + RIDE_WINDOW_BUFFER_MS) : null,
  };
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
