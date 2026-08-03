import type { LatLng } from "@baraat/types";

const BASE = "https://maps.googleapis.com/maps/api";

function key(): string {
  const k = process.env.GOOGLE_MAPS_API_KEY;
  if (!k) throw new Error("GOOGLE_MAPS_API_KEY not set");
  return k;
}

export async function googleMatrix(
  origins: LatLng[],
  destinations: LatLng[],
): Promise<{ seconds: number; meters: number }[][]> {
  const o = origins.map((p) => `${p.lat},${p.lng}`).join("|");
  const d = destinations.map((p) => `${p.lat},${p.lng}`).join("|");
  const url = `${BASE}/distancematrix/json?origins=${encodeURIComponent(o)}&destinations=${encodeURIComponent(d)}&departure_time=now&key=${key()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Distance Matrix HTTP ${res.status}`);
  const json = (await res.json()) as any;
  if (json.status !== "OK") throw new Error(`Distance Matrix: ${json.status}`);
  return json.rows.map((row: any) =>
    row.elements.map((el: any) => ({
      seconds:
        el.status === "OK"
          ? (el.duration_in_traffic?.value ?? el.duration.value)
          : Number.MAX_SAFE_INTEGER,
      meters: el.status === "OK" ? el.distance.value : Number.MAX_SAFE_INTEGER,
    })),
  );
}

export async function googleDirections(
  origin: LatLng,
  destination: LatLng,
  waypoints: LatLng[],
): Promise<{ orderedWaypointIndexes: number[]; legSeconds: number[]; legMeters: number[] }> {
  const wp =
    waypoints.length > 0
      ? `&waypoints=optimize:true|${waypoints.map((p) => `${p.lat},${p.lng}`).join("|")}`
      : "";
  const url = `${BASE}/directions/json?origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}${wp}&departure_time=now&key=${key()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Directions HTTP ${res.status}`);
  const json = (await res.json()) as any;
  if (json.status !== "OK") throw new Error(`Directions: ${json.status}`);
  const route = json.routes[0];
  return {
    orderedWaypointIndexes: route.waypoint_order ?? [],
    legSeconds: route.legs.map((l: any) => l.duration_in_traffic?.value ?? l.duration.value),
    legMeters: route.legs.map((l: any) => l.distance.value),
  };
}
