"use client";

import dynamic from "next/dynamic";
import { usePoll } from "@/lib/client";

interface RouteResponse {
  status: string;
  origin: { lat: number; lng: number; label: string | null };
  dest: { lat: number; lng: number; label: string | null };
  driver: { lat: number; lng: number } | null;
  toPickup: { points: { lat: number; lng: number }[]; seconds: number } | null;
  toDest: { points: { lat: number; lng: number }[]; seconds: number } | null;
}

function InnerTripMap({ route }: { route: RouteResponse }) {

  const { MapContainer, TileLayer, CircleMarker, Polyline, Tooltip } = require("react-leaflet");

  const boarded = route.status === "BOARDED";
  const activeLeg =
    route.status === "ACCEPTED" ? route.toPickup : boarded ? route.toDest : null;
  const line = (activeLeg?.points ?? []).map((p) => [p.lat, p.lng] as [number, number]);
  const center: [number, number] = route.driver
    ? [route.driver.lat, route.driver.lng]
    : [route.origin.lat, route.origin.lng];

  return (
    <MapContainer center={center} zoom={13} scrollWheelZoom>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {line.length > 1 && (
        <Polyline
          positions={line}
          pathOptions={{ color: boarded ? "#8b5cf6" : "#0ea5e9", weight: 5, opacity: 0.85 }}
        />
      )}
      {route.driver && (
        <CircleMarker
          center={[route.driver.lat, route.driver.lng]}
          radius={9}
          pathOptions={{ color: "#fff", weight: 2, fillColor: "#10b981", fillOpacity: 1 }}
        >
          <Tooltip direction="top" offset={[0, -8]}>You</Tooltip>
        </CircleMarker>
      )}
      <CircleMarker
        center={[route.origin.lat, route.origin.lng]}
        radius={7}
        pathOptions={{ color: "#fff", weight: 2, fillColor: "#0ea5e9", fillOpacity: 1 }}
      >
        <Tooltip direction="top" offset={[0, -8]}>Pickup: {route.origin.label ?? ""}</Tooltip>
      </CircleMarker>
      <CircleMarker
        center={[route.dest.lat, route.dest.lng]}
        radius={7}
        pathOptions={{ color: "#fff", weight: 2, fillColor: "#c2405a", fillOpacity: 1 }}
      >
        <Tooltip direction="top" offset={[0, -8]}>Drop: {route.dest.label ?? ""}</Tooltip>
      </CircleMarker>
    </MapContainer>
  );
}

const NoSSRTripMap = dynamic(() => Promise.resolve(InnerTripMap), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-soft">Loading map…</div>
  ),
});

export function DriverTripMap({ tripId, status }: { tripId: string; status: string }) {
  const { data: route } = usePoll<RouteResponse>(`/trips/${tripId}/route`, 8000);
  if (!route) {
    return (
      <div className="card flex h-56 items-center justify-center p-1 text-sm text-soft">
        Loading route…
      </div>
    );
  }

  const boarded = status === "BOARDED" || status === "ARRIVED_DROP";
  const showNavigate = status === "ACCEPTED" || status === "BOARDED";
  const target = boarded ? route.dest : route.origin;
  const targetLabel = boarded
    ? `drop-off${route.dest.label ? ` — ${route.dest.label}` : ""}`
    : `pickup${route.origin.label ? ` — ${route.origin.label}` : ""}`;

  function navigate() {
    const isApple = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const url = isApple
      ? `http://maps.apple.com/?daddr=${target.lat},${target.lng}&dirflg=d`
      : `https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}&travelmode=driving`;
    window.open(url, "_blank");
  }

  return (
    <div className="space-y-2">
      <div className="card h-56 overflow-hidden p-1 sm:h-64">
        <NoSSRTripMap route={route} />
      </div>
      {showNavigate && (
        <button onClick={navigate} className="btn-secondary flex items-center justify-center gap-2">
          🧭 Navigate to {targetLabel}
        </button>
      )}
    </div>
  );
}
