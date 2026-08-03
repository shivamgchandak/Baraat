"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";

export interface MapDriver {
  id: string;
  name: string;
  vehicleNumber: string;
  status: string;
  lat: number | null;
  lng: number | null;
}

export interface MapPoint {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
}

const COLORS: Record<string, string> = {
  IDLE: "#10b981",
  EN_ROUTE_PICKUP: "#0ea5e9",
  OCCUPIED: "#8b5cf6",
  ON_BREAK: "#f59e0b",
  OFFLINE: "#9ca3af",
};

function InnerMap({ drivers, waiting }: { drivers: MapDriver[]; waiting: MapPoint[] }) {

  const { MapContainer, TileLayer, CircleMarker, Tooltip } = require("react-leaflet");

  const located = drivers.filter((d) => d.lat != null && d.lng != null);
  const locatedGuests = waiting.filter((g) => g.lat != null && g.lng != null);

  const center: [number, number] =
    located.length > 0
      ? [located[0]!.lat!, located[0]!.lng!]
      : [16.7093, 74.2349];

  return (
    <MapContainer center={center} zoom={12} scrollWheelZoom>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {located.map((d) => (
        <CircleMarker
          key={d.id}
          center={[d.lat!, d.lng!]}
          radius={9}
          pathOptions={{
            color: "#ffffff",
            weight: 2,
            fillColor: COLORS[d.status] ?? "#9ca3af",
            fillOpacity: 1,
          }}
        >
          <Tooltip direction="top" offset={[0, -8]}>
            <b>{d.name}</b> · {d.vehicleNumber}
            <br />
            {d.status.replaceAll("_", " ")}
          </Tooltip>
        </CircleMarker>
      ))}
      {locatedGuests.map((g) => (
        <CircleMarker
          key={g.id}
          center={[g.lat!, g.lng!]}
          radius={6}
          pathOptions={{ color: "#e11d48", weight: 2, fillColor: "#fda4af", fillOpacity: 0.9 }}
        >
          <Tooltip direction="top" offset={[0, -6]}>
            <b>{g.name}</b> · waiting
          </Tooltip>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}

const NoSSRMap = dynamic(() => Promise.resolve(InnerMap), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-soft">Loading map…</div>
  ),
});

export function LiveMap(props: { drivers: MapDriver[]; waiting: MapPoint[] }) {
  const key = useMemo(() => "livemap", []);
  return <NoSSRMap key={key} {...props} />;
}
