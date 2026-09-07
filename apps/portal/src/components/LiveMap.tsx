"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client";

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

function InnerMap({
  drivers,
  waiting,
  center,
}: {
  drivers: MapDriver[];
  waiting: MapPoint[];
  center: [number, number];
}) {

  const { MapContainer, TileLayer, CircleMarker, Tooltip } = require("react-leaflet");

  const located = drivers.filter((d) => d.lat != null && d.lng != null);
  const locatedGuests = waiting.filter((g) => g.lat != null && g.lng != null);

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

interface SavedLocations {
  accommodations: { id: string; name: string; lat: number; lng: number }[];
  places: { id: string; name: string; kind: string; lat: number; lng: number }[];
}

export function LiveMap({ drivers, waiting }: { drivers: MapDriver[]; waiting: MapPoint[] }) {
  const [venue, setVenue] = useState<[number, number] | null>(null);
  const [userPos, setUserPos] = useState<[number, number] | null>(null);
  const [geoFailed, setGeoFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const res = await api<SavedLocations>("/locations/saved");
      if (!alive || !res.ok || !res.data) return;
      const places = res.data.places ?? [];
      const spot =
        places.find((p) => p.kind === "VENUE") ??
        places[0] ??
        (res.data.accommodations ?? [])[0];
      setVenue(spot ? [spot.lat, spot.lng] : null);
    };
    void load();
    const id = setInterval(load, 30000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setGeoFailed(true);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setUserPos([pos.coords.latitude, pos.coords.longitude]),
      () => setGeoFailed(true),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60_000 },
    );
  }, []);

  const located = drivers.filter((d) => d.lat != null && d.lng != null);
  const driverPos: [number, number] | null =
    located.length > 0 ? [located[0]!.lat!, located[0]!.lng!] : null;

  const center = venue ?? driverPos ?? userPos;

  const key = useMemo(
    () => (venue ? `venue:${venue[0].toFixed(4)},${venue[1].toFixed(4)}` : driverPos ? "driver" : "user"),
    [venue, driverPos ? "driver" : "user"],
  );

  if (!center) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-soft">
        {geoFailed
          ? "Allow location access to centre the map, or create an event with a venue."
          : "Finding your location…"}
      </div>
    );
  }

  return <NoSSRMap key={key} drivers={drivers} waiting={waiting} center={center} />;
}
