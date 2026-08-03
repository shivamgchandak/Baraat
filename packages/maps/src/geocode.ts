
import { getKv } from "@baraat/kv";

export interface GeocodeHit {
  label: string;
  lat: number;
  lng: number;
}

const TTL_S = 6 * 60 * 60;

export async function geocode(query: string): Promise<GeocodeHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const kv = getKv();
  const key = `geo:${q.toLowerCase()}`;
  const hit = await kv.get(key);
  if (hit) return JSON.parse(hit) as GeocodeHit[];

  let results: GeocodeHit[] = [];
  try {
    if (process.env.GOOGLE_MAPS_API_KEY) {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&region=in&key=${process.env.GOOGLE_MAPS_API_KEY}`;
      const res = await fetch(url);
      const json = (await res.json()) as any;
      if (json.status === "OK") {
        results = json.results.slice(0, 6).map((r: any) => ({
          label: r.formatted_address,
          lat: r.geometry.location.lat,
          lng: r.geometry.location.lng,
        }));
      }
    } else {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=6&q=${encodeURIComponent(q)}`;
      const res = await fetch(url, {
        headers: { "user-agent": "baraat-dispatch/0.1 (event logistics demo)" },
      });
      if (res.ok) {
        const json = (await res.json()) as any[];
        results = json.map((r) => ({
          label: r.display_name as string,
          lat: Number(r.lat),
          lng: Number(r.lon),
        }));
      }
    }
  } catch {

    return [];
  }

  await kv.set(key, JSON.stringify(results), TTL_S);
  return results;
}

export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  const kv = getKv();
  const key = `rgeo:${lat.toFixed(4)},${lng.toFixed(4)}`;
  const hit = await kv.get(key);
  if (hit) return hit;

  let label = `Near ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  try {
    if (process.env.GOOGLE_MAPS_API_KEY) {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
      const res = await fetch(url);
      const json = (await res.json()) as any;
      if (json.status === "OK" && json.results[0]) label = json.results[0].formatted_address;
    } else {
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`;
      const res = await fetch(url, {
        headers: { "user-agent": "baraat-dispatch/0.1 (event logistics demo)" },
      });
      if (res.ok) {
        const json = (await res.json()) as any;
        if (json.display_name) label = json.display_name;
      }
    }
  } catch {
  }
  await kv.set(key, label, TTL_S);
  return label;
}
