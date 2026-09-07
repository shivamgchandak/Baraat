
import { getKv } from "@baraat/kv";

export interface GeocodeHit {
  label: string;
  lat: number;
  lng: number;
}

const TTL_S = 6 * 60 * 60;
const UA = "baraat-dispatch/0.1 (event logistics demo)";

export interface GeoBias {
  lat: number;
  lng: number;
}

/** Build a readable one-line label from Photon's structured properties. */
function photonLabel(p: Record<string, unknown>): string {
  const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const street = s(p.street);
  const house = s(p.housenumber);
  const parts = [
    s(p.name),
    street ? (house ? `${house} ${street}` : street) : null,
    s(p.district),
    s(p.city) ?? s(p.county),
    s(p.state),
  ].filter((x): x is string => Boolean(x));

  const seen = new Set<string>();
  return parts
    .filter((x) => {
      const k = x.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .join(", ");
}

export async function geocode(query: string, bias?: GeoBias): Promise<GeocodeHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const kv = getKv();
  const biasKey = bias ? `${bias.lat.toFixed(2)},${bias.lng.toFixed(2)}` : "";
  const key = `geo:${q.toLowerCase()}:${biasKey}`;
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

      const params = new URLSearchParams({ q, limit: "6", lang: "en" });
      if (bias) {
        params.set("lat", String(bias.lat));
        params.set("lon", String(bias.lng));
      }
      const res = await fetch(`https://photon.komoot.io/api/?${params.toString()}`, {
        headers: { "user-agent": UA },
      });
      if (res.ok) {
        const json = (await res.json()) as any;
        results = (Array.isArray(json?.features) ? json.features : [])
          .map((f: any) => {
            const coords = f?.geometry?.coordinates;
            if (!Array.isArray(coords) || coords.length < 2) return null;
            return {
              label: photonLabel(f?.properties ?? {}),
              lat: Number(coords[1]),
              lng: Number(coords[0]),
            };
          })
          .filter(
            (h: GeocodeHit | null): h is GeocodeHit =>
              Boolean(h?.label) && Number.isFinite(h!.lat) && Number.isFinite(h!.lng),
          );
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
      const url = `https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}&limit=1&lang=en`;
      const res = await fetch(url, { headers: { "user-agent": UA } });
      if (res.ok) {
        const json = (await res.json()) as any;
        const props = json?.features?.[0]?.properties;
        const built = props ? photonLabel(props) : "";
        if (built) label = built;
      }
    }
  } catch {
  }
  await kv.set(key, label, TTL_S);
  return label;
}
