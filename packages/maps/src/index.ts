/**
 * Maps adapter — one interface, two providers:
 *  - "google": Distance Matrix + Directions (live traffic) when
 *    GOOGLE_MAPS_API_KEY is set
 *  - "mock":  haversine × road factor × time-varying traffic model
 *    (deterministic, zero-cost; used for local dev / review / simulation)
 *
 * Efficiency NFR:
 *  - static legs (accommodation→venue etc.) cached in KV with a long TTL
 *  - dynamic legs cached for 60s (traffic-fresh but dedupes engine ticks)
 *  - matrix calls batched, never one-call-per-pair
 */
import type { EtaResult, LatLng } from "@baraat/types";
import { getKv } from "@baraat/kv";
import { mockEta } from "./mock.js";
import { googleDirections, googleMatrix } from "./google.js";

export { haversineMeters, mockEta } from "./mock.js";
export { geocode, reverseGeocode, type GeocodeHit } from "./geocode.js";

const DYNAMIC_TTL_S = 60;
const STATIC_TTL_S = 60 * 60 * 6;

function usingGoogle(): boolean {
  return Boolean(process.env.GOOGLE_MAPS_API_KEY);
}

function cacheKey(a: LatLng, b: LatLng): string {
  // ~110m grid: close-enough points share a cache entry
  const r = (n: number) => n.toFixed(3);
  return `eta:${r(a.lat)},${r(a.lng)}:${r(b.lat)},${r(b.lng)}`;
}

export async function eta(
  from: LatLng,
  to: LatLng,
  opts: { static?: boolean } = {},
): Promise<EtaResult> {
  const kv = getKv();
  const key = cacheKey(from, to);
  const hit = await kv.get(key);
  if (hit) {
    const p = JSON.parse(hit) as { seconds: number; meters: number };
    return { ...p, provider: usingGoogle() ? "google" : "mock", cached: true };
  }
  let seconds: number;
  let meters: number;
  if (usingGoogle()) {
    const m = await googleMatrix([from], [to]);
    seconds = m[0]![0]!.seconds;
    meters = m[0]![0]!.meters;
  } else {
    ({ seconds, meters } = mockEta(from, to));
  }
  await kv.set(
    key,
    JSON.stringify({ seconds, meters }),
    opts.static ? STATIC_TTL_S : DYNAMIC_TTL_S,
  );
  return { seconds, meters, provider: usingGoogle() ? "google" : "mock", cached: false };
}

/** Bulk driver→guest ETAs. Batched for Google; loop for mock. */
export async function etaMatrix(
  origins: LatLng[],
  destinations: LatLng[],
): Promise<{ seconds: number; meters: number }[][]> {
  if (origins.length === 0 || destinations.length === 0) return [];
  if (usingGoogle()) {
    // Google caps 25x25 per request; chunk if needed.
    const CHUNK = 25;
    const result: { seconds: number; meters: number }[][] = origins.map(() => []);
    for (let oi = 0; oi < origins.length; oi += CHUNK) {
      const oSlice = origins.slice(oi, oi + CHUNK);
      for (let di = 0; di < destinations.length; di += CHUNK) {
        const dSlice = destinations.slice(di, di + CHUNK);
        const part = await googleMatrix(oSlice, dSlice);
        part.forEach((row, i) => {
          result[oi + i]!.push(...row);
        });
      }
    }
    return result;
  }
  return origins.map((o) => destinations.map((d) => mockEta(o, d)));
}

/**
 * Multi-stop route: returns ordered stops + cumulative seconds.
 * Google path uses Directions optimizeWaypoints; mock path uses
 * nearest-neighbour ordering (fine at ≤3 intermediate stops).
 */
export async function orderedRoute(
  origin: LatLng,
  stops: LatLng[],
  destination: LatLng,
): Promise<{ order: number[]; cumulativeSeconds: number[]; totalSeconds: number; totalMeters: number }> {
  if (usingGoogle() && stops.length > 0) {
    const g = await googleDirections(origin, destination, stops);
    const cumulative: number[] = [];
    let acc = 0;
    for (const s of g.legSeconds) {
      acc += s;
      cumulative.push(acc);
    }
    return {
      order: g.orderedWaypointIndexes,
      cumulativeSeconds: cumulative,
      totalSeconds: acc,
      totalMeters: g.legMeters.reduce((a, b) => a + b, 0),
    };
  }
  // Mock: greedy nearest-neighbour from origin.
  const remaining = stops.map((p, i) => ({ p, i }));
  const order: number[] = [];
  let cur = origin;
  let acc = 0;
  let meters = 0;
  const cumulative: number[] = [];
  while (remaining.length > 0) {
    remaining.sort(
      (x, y) => mockEta(cur, x.p).seconds - mockEta(cur, y.p).seconds,
    );
    const next = remaining.shift()!;
    const leg = mockEta(cur, next.p);
    acc += leg.seconds;
    meters += leg.meters;
    cumulative.push(acc);
    order.push(next.i);
    cur = next.p;
  }
  const last = mockEta(cur, destination);
  acc += last.seconds;
  meters += last.meters;
  cumulative.push(acc);
  return { order, cumulativeSeconds: cumulative, totalSeconds: acc, totalMeters: meters };
}
