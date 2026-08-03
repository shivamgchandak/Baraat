
import type { LatLng } from "@baraat/types";
import { getKv } from "@baraat/kv";
import { mockEta } from "./mock.js";

export interface RouteLeg {
  points: LatLng[];
  seconds: number;
  meters: number;
}

const TTL_S = 120;

export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    for (const target of ["lat", "lng"] as const) {
      let result = 0;
      let shift = 0;
      let byte = 0x20;
      while (byte >= 0x20) {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      }
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (target === "lat") lat += delta;
      else lng += delta;
    }
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

export async function routeLeg(from: LatLng, to: LatLng): Promise<RouteLeg> {
  const kv = getKv();
  const r = (n: number) => n.toFixed(4);
  const key = `route:${r(from.lat)},${r(from.lng)}:${r(to.lat)},${r(to.lng)}`;
  const hit = await kv.get(key);
  if (hit) return JSON.parse(hit) as RouteLeg;

  let leg: RouteLeg | null = null;
  if (process.env.GOOGLE_MAPS_API_KEY) {
    try {
      const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}&departure_time=now&key=${process.env.GOOGLE_MAPS_API_KEY}`;
      const res = await fetch(url);
      const json = (await res.json()) as any;
      if (json.status === "OK" && json.routes[0]) {
        const route = json.routes[0];
        leg = {
          points: decodePolyline(route.overview_polyline.points),
          seconds:
            route.legs[0]?.duration_in_traffic?.value ?? route.legs[0]?.duration?.value ?? 0,
          meters: route.legs[0]?.distance?.value ?? 0,
        };
      }
    } catch {
      leg = null;
    }
  }
  if (!leg) {
    const e = mockEta(from, to);
    leg = { points: [from, to], seconds: e.seconds, meters: e.meters };
  }
  await kv.set(key, JSON.stringify(leg), TTL_S);
  return leg;
}
