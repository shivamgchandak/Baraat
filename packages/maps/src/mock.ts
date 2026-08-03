import type { LatLng } from "@baraat/types";

const EARTH_RADIUS_M = 6371000;

export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export function mockEta(a: LatLng, b: LatLng, at: Date = new Date()) {
  const meters = haversineMeters(a, b) * 1.35;
  const baseSpeedMps = 24_000 / 3600;
  const bucket = Math.floor(at.getTime() / (5 * 60 * 1000));

  const seed = Math.abs(
    Math.sin(bucket * 12.9898 + (a.lat + b.lat) * 78.233 + (a.lng + b.lng) * 37.719),
  );
  const trafficFactor = 0.75 + seed * 0.7;
  const seconds = Math.round((meters / baseSpeedMps) * trafficFactor);
  return { meters: Math.round(meters), seconds };
}
