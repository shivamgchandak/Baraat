import React, { useEffect, useState } from "react";
import { Linking, Platform, View } from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";
import { api, fmtEta } from "../api";
import { useTheme } from "../theme";
import { Badge, Btn, Card, H1, P } from "../components/UI";

interface RideInfo {
  tripId: string;
  status: string;
  etaSeconds: number | null;
  destLabel: string | null;
  driver: {
    name: string;
    phone: string | null;
    vehicleNumber: string;
    lat: number | null;
    lng: number | null;
  };
}

interface RouteInfo {
  status: string;
  origin: { lat: number; lng: number; label: string | null };
  dest: { lat: number; lng: number; label: string | null };
  driver: { lat: number; lng: number } | null;
  toPickup: { points: { lat: number; lng: number }[]; seconds: number } | null;
  toDest: { points: { lat: number; lng: number }[]; seconds: number } | null;
}

const STATUS_TEXT: Record<string, { label: string; color: string }> = {
  ASSIGNED: { label: "DRIVER ASSIGNED", color: "#0ea5e9" },
  ACCEPTED: { label: "DRIVER ON THE WAY", color: "#0ea5e9" },
  ARRIVED_PICKUP: { label: "DRIVER HAS ARRIVED", color: "#10b981" },
  BOARDED: { label: "ON YOUR WAY", color: "#8b5cf6" },
};

export function RideScreen({
  eventActive,
  waitingForDriver,
  phase,
  startsAt,
}: {
  eventActive: boolean;
  waitingForDriver: boolean;
  phase: string;
  startsAt: string | null;
}) {
  const t = useTheme();
  const [ride, setRide] = useState<RideInfo | null>(null);
  const [route, setRoute] = useState<RouteInfo | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [otp, setOtp] = useState<string | null>(null);
  const [otpBusy, setOtpBusy] = useState(false);

  async function generateOtp() {
    setOtpBusy(true);
    const res = await api<{ otp?: string; error?: unknown }>("/guests/me/ride/otp", {
      method: "POST",
      body: JSON.stringify({}),
    });
    setOtpBusy(false);
    if (res.ok && res.data.otp) setOtp(res.data.otp);
  }

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const res = await api<RideInfo | null>("/guests/me/ride");
      if (!alive) return;
      if (res.ok) {
        setRide(res.data);
        setLoaded(true);
        setFailed(false);
        if (!res.data || res.data.status !== "ARRIVED_PICKUP") setOtp(null);
        if (res.data?.tripId) {
          const r = await api<RouteInfo>(`/trips/${res.data.tripId}/route`);
          if (alive && r.ok) setRoute(r.data);
        } else {
          setRoute(null);
        }
      } else if (!loaded) {
        setFailed(true);
      }
    };
    void load();
    const id = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  function activeLeg(): { points: { lat: number; lng: number }[]; from: { lat: number; lng: number }; to: { lat: number; lng: number } } | null {
    if (!route || !ride) return null;
    if (ride.status === "ACCEPTED" && route.toPickup && route.driver) {
      return { points: route.toPickup.points, from: route.driver, to: route.origin };
    }
    if (ride.status === "BOARDED" && route.toDest) {
      return { points: route.toDest.points, from: route.origin, to: route.dest };
    }
    return null;
  }

  function openInMaps() {
    const leg = activeLeg();
    if (!leg) return;
    const url =
      Platform.OS === "ios"
        ? `http://maps.apple.com/?saddr=${leg.from.lat},${leg.from.lng}&daddr=${leg.to.lat},${leg.to.lng}&dirflg=d`
        : `https://www.google.com/maps/dir/?api=1&origin=${leg.from.lat},${leg.from.lng}&destination=${leg.to.lat},${leg.to.lng}&travelmode=driving`;
    void Linking.openURL(url);
  }

  if (!eventActive) {
    const before = phase === "before";
    const after = phase === "after" || phase === "closed";
    return (
      <Card t={t} style={{ alignItems: "center", gap: 6, paddingVertical: 30 }}>
        <P t={t} style={{ fontSize: 30 }}>📅</P>
        <P t={t} style={{ fontWeight: "700", fontSize: 16 }}>
          {before ? "Event hasn't started yet" : after ? "The event has ended" : "No active event"}
        </P>
        <P t={t} soft style={{ textAlign: "center" }}>
          {before
            ? `Rides open on ${startsAt ? new Date(startsAt).toLocaleString([], { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "the start date"}.`
            : after
              ? "Ride requests are closed for this event."
              : "Your rides will appear here once your event is live."}
        </P>
      </Card>
    );
  }

  if (!loaded && failed) {
    return (
      <Card t={t} style={{ alignItems: "center", gap: 6, paddingVertical: 24 }}>
        <P t={t} style={{ fontSize: 30 }}>📡</P>
        <P t={t} style={{ fontWeight: "700", fontSize: 16 }}>Can&apos;t reach the server</P>
        <P t={t} soft style={{ textAlign: "center" }}>
          Your session may have expired or the server was reset. Go to Details and sign out, then
          sign in again.
        </P>
      </Card>
    );
  }

  if (!loaded) {
    return (
      <Card t={t}>
        <P t={t} soft>Checking your ride…</P>
      </Card>
    );
  }

  if (!ride) {

    if (waitingForDriver) {
      return (
        <Card t={t} style={{ alignItems: "center", paddingVertical: 30, gap: 6 }}>
          <Badge t={t} label="UPCOMING RIDE" color={t.warn} />
          <P t={t} style={{ fontSize: 15, marginTop: 6 }}>🔎</P>
          <P t={t} style={{ fontWeight: "700", fontSize: 17 }}>Finding you a driver</P>
          <P t={t} soft style={{ textAlign: "center" }}>
            Your ride is confirmed and queued. As soon as a driver is free, they&apos;ll appear here
            with live location and ETA. Keep this screen open.
          </P>
        </Card>
      );
    }
    return (
      <Card t={t} style={{ alignItems: "center", paddingVertical: 30, gap: 6 }}>
        <P t={t} style={{ fontSize: 15 }}>🕓</P>
        <P t={t} style={{ fontWeight: "700", fontSize: 17 }}>No ride right now</P>
        <P t={t} soft style={{ textAlign: "center" }}>
          When a driver is matched to you, they&apos;ll appear here automatically — with their name,
          vehicle and live location. You never need to choose one.
        </P>
      </Card>
    );
  }

  const status = STATUS_TEXT[ride.status] ?? { label: ride.status, color: t.soft };
  const leg = activeLeg();
  const line = leg?.points ?? [];
  const driverPos = route?.driver ?? null;

  return (
    <View style={{ gap: 12 }}>
      <Card t={t} style={{ gap: 8 }}>
        <Badge t={t} label={status.label} color={status.color} />
        <H1 t={t}>{ride.driver.name}</H1>
        <P t={t}>
          Vehicle <P t={t} style={{ fontWeight: "700" }}>{ride.driver.vehicleNumber}</P>
          {ride.status !== "BOARDED" && ride.etaSeconds != null
            ? `  ·  ETA ${fmtEta(ride.etaSeconds)}`
            : ""}
        </P>
        {ride.destLabel ? <P t={t} soft>Heading to {ride.destLabel}</P> : null}
        {ride.driver.phone ? (
          <Btn
            t={t}
            kind="secondary"
            label={`📞 Call ${ride.driver.name.split(" ")[0]}`}
            onPress={() => void Linking.openURL(`tel:${ride.driver.phone}`)}
          />
        ) : null}
      </Card>

      {ride.status === "ARRIVED_PICKUP" && (
        <Card t={t} style={{ gap: 10, alignItems: "center" }}>
          {otp ? (
            <>
              <P t={t} soft>Show this code to your driver</P>
              <P t={t} style={{ fontSize: 20, fontWeight: "800", letterSpacing: 10 }}>{otp}</P>
              <P t={t} soft style={{ textAlign: "center", fontSize: 13 }}>
                The driver enters it to start the trip. Keep this screen open.
              </P>
            </>
          ) : (
            <>
              <P t={t} style={{ fontWeight: "700", fontSize: 16 }}>Your driver is here 📍</P>
              <P t={t} soft style={{ textAlign: "center" }}>
                Generate a boarding code and show it to the driver to start your trip.
              </P>
              <Btn t={t} label="Generate boarding code" onPress={generateOtp} busy={otpBusy} />
            </>
          )}
        </Card>
      )}

      {route && (
        <Card t={t} style={{ padding: 4, overflow: "hidden" }}>
          <MapView
            style={{ height: 300, borderRadius: 10 }}
            initialRegion={{
              latitude: route.origin.lat,
              longitude: route.origin.lng,
              latitudeDelta: 0.12,
              longitudeDelta: 0.12,
            }}
          >
            {line.length > 1 && (
              <Polyline
                coordinates={line.map((p) => ({ latitude: p.lat, longitude: p.lng }))}
                strokeColor={t.brand}
                strokeWidth={4}
              />
            )}
            <Marker
              coordinate={{ latitude: route.origin.lat, longitude: route.origin.lng }}
              title={`Pickup${route.origin.label ? `: ${route.origin.label}` : ""}`}
              pinColor="#0ea5e9"
            />
            <Marker
              coordinate={{ latitude: route.dest.lat, longitude: route.dest.lng }}
              title={`Destination${route.dest.label ? `: ${route.dest.label}` : ""}`}
              pinColor="#c2405a"
            />
            {driverPos && (
              <Marker
                coordinate={{ latitude: driverPos.lat, longitude: driverPos.lng }}
                title={`${ride.driver.name} · ${ride.driver.vehicleNumber}`}
              >
                <View
                  style={{
                    backgroundColor: "#10b981",
                    borderColor: "#fff",
                    borderWidth: 2,
                    width: 18,
                    height: 18,
                    borderRadius: 9,
                  }}
                />
              </Marker>
            )}
          </MapView>
        </Card>
      )}

      {leg && <Btn t={t} kind="secondary" label="🗺️ Open route in Maps" onPress={openInMaps} />}
    </View>
  );
}
