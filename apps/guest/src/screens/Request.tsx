import React, { useEffect, useRef, useState } from "react";
import { Platform, Pressable, View } from "react-native";
import * as Location from "expo-location";
import { api } from "../api";
import { useTheme } from "../theme";
import { Badge, Btn, Card, H1, Input, P } from "../components/UI";

interface RideRequest {
  id: string;
  status: "PENDING" | "APPROVED" | "DECLINED";
  note: string | null;
  requestedAt: string;
}

interface PlaceHit {
  label: string;
  lat: number;
  lng: number;
  kind: string;
}

type Picked = { label: string; lat: number; lng: number } | null;

export function RequestScreen({
  eventActive,
  hasActiveRide,
  phase,
  startsAt,
}: {
  eventActive: boolean;
  hasActiveRide: boolean;
  phase: string;
  startsAt: string | null;
}) {
  const t = useTheme();
  const [requests, setRequests] = useState<RideRequest[] | null>(null);
  const [note, setNote] = useState("");
  const [pickup, setPickup] = useState<Picked>(null);
  const [drop, setDrop] = useState<Picked>(null);
  const [people, setPeople] = useState("1");
  const [luggage, setLuggage] = useState("0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [okMsg, setOkMsg] = useState("");

  const load = async () => {
    const res = await api<RideRequest[]>("/guests/me/requests");
    if (res.ok) setRequests(res.data);
  };

  useEffect(() => {
    void load();
    const id = setInterval(load, 6000);
    return () => clearInterval(id);
  }, []);

  const pending = requests?.find((r) => r.status === "PENDING");

  async function useCurrent(setter: (p: Picked) => void) {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") { setError("Allow location access, or search a place instead."); return; }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const res = await api<{ label: string }>(`/locations/reverse?lat=${pos.coords.latitude}&lng=${pos.coords.longitude}`);
      setter({
        label: res.ok && res.data?.label ? res.data.label : "Current location",
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
      });
    } catch {
      setError("Couldn't get your location.");
    }
  }

  async function submit() {
    if (!pickup) { setError("Choose a pickup point"); return; }
    if (!drop) { setError("Choose a drop location"); return; }
    setBusy(true);
    setError("");
    setOkMsg("");
    const res = await api<{ error?: unknown }>("/guests/me/requests", {
      method: "POST",
      body: JSON.stringify({
        note: note || undefined,
        pickupLat: pickup.lat, pickupLng: pickup.lng, pickupLabel: pickup.label,
        dropLat: drop.lat, dropLng: drop.lng, dropLabel: drop.label,
        groupSize: Number(people) || 1,
        luggageCount: Number(luggage) || 0,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      setError(typeof res.data?.error === "string" ? String(res.data.error) : "Couldn't send the request");
      return;
    }
    setNote(""); setPickup(null); setDrop(null); setPeople("1"); setLuggage("0");
    setOkMsg("Request sent! The team will review it shortly.");
    void load();
  }

  if (!eventActive) {
    const before = phase === "before";
    const after = phase === "after" || phase === "closed";
    return (
      <Card t={t} style={{ alignItems: "center", gap: 6, paddingVertical: 30 }}>
        <P t={t} style={{ fontSize: 30 }}>📅</P>
        <P t={t} style={{ fontWeight: "700", fontSize: 16 }}>
          {before ? "Event hasn't started" : after ? "Event has ended" : "No active event"}
        </P>
        <P t={t} soft style={{ textAlign: "center" }}>
          {before
            ? `Ride requests open on ${startsAt ? new Date(startsAt).toLocaleString([], { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "the start date"}.`
            : after
              ? "Ride requests are closed for this event."
              : "Ride requests open when your event is live."}
        </P>
      </Card>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      <Card t={t} style={{ gap: 10 }}>
        <H1 t={t}>Need a ride?</H1>
        <P t={t} soft>
          Send a request; the operations team reviews it and a driver is then assigned automatically.
        </P>

        {pending ? (
          <Card t={t} style={{ backgroundColor: t.surface, alignItems: "center", gap: 6 }}>
            <Badge t={t} label="REQUEST PENDING" color={t.warn} />
            <P t={t} soft style={{ textAlign: "center" }}>
              Waiting for approval. You&apos;ll be matched with a driver right after — watch the Ride tab.
            </P>
          </Card>
        ) : hasActiveRide ? (
          <Card t={t} style={{ backgroundColor: t.surface, alignItems: "center", gap: 6 }}>
            <Badge t={t} label="RIDE IN PROGRESS" color={t.info} />
            <P t={t} soft style={{ textAlign: "center" }}>
              You already have a current or upcoming ride. You can request again once it&apos;s completed.
            </P>
          </Card>
        ) : (
          <>
            <PlaceField t={t} label="Pickup point" value={pickup} onChange={setPickup} onCurrent={() => useCurrent(setPickup)} />
            <PlaceField t={t} label="Drop location" value={drop} onChange={setDrop} onCurrent={() => useCurrent(setDrop)} />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <P t={t} soft style={{ fontSize: 12, marginBottom: 4 }}>People</P>
                <Input t={t} keyboardType="number-pad" value={people} onChangeText={setPeople} />
              </View>
              <View style={{ flex: 1 }}>
                <P t={t} soft style={{ fontSize: 12, marginBottom: 4 }}>Luggage</P>
                <Input t={t} keyboardType="number-pad" value={luggage} onChangeText={setLuggage} />
              </View>
            </View>
            <Input t={t} placeholder="Anything the team should know? (optional)" value={note} onChangeText={setNote} multiline />
            {error ? <P t={t} style={{ color: "#e11d48" }}>{error}</P> : null}
            {okMsg ? <P t={t} style={{ color: t.ok }}>{okMsg}</P> : null}
            <Btn t={t} label="Request a ride" onPress={submit} busy={busy} />
          </>
        )}
      </Card>

      {requests && requests.length > 0 && (
        <Card t={t} style={{ gap: 8 }}>
          <P t={t} style={{ fontWeight: "700" }}>Recent requests</P>
          {requests.slice(0, 5).map((r) => (
            <View key={r.id} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <P t={t} soft>
                {new Date(r.requestedAt).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
              </P>
              <Badge t={t} label={r.status} color={r.status === "APPROVED" ? t.ok : r.status === "DECLINED" ? "#e11d48" : t.warn} />
            </View>
          ))}
        </Card>
      )}
    </View>
  );
}

function PlaceField({
  t,
  label,
  value,
  onChange,
  onCurrent,
}: {
  t: ReturnType<typeof useTheme>;
  label: string;
  value: Picked;
  onChange: (p: Picked) => void;
  onCurrent: () => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<PlaceHit[]>([]);
  const [searching, setSearching] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onType(text: string) {
    setQ(text);
    onChange(null);
    if (debounce.current) clearTimeout(debounce.current);
    if (text.trim().length < 2) { setHits([]); return; }
    debounce.current = setTimeout(async () => {
      setSearching(true);
      const res = await api<PlaceHit[]>(`/locations/search?q=${encodeURIComponent(text)}`);
      setSearching(false);
      if (res.ok && Array.isArray(res.data)) setHits(res.data);
    }, 350);
  }

  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <P t={t} soft style={{ fontSize: 12 }}>{label}</P>
        <Pressable onPress={onCurrent}>
          <P t={t} style={{ color: t.brand, fontSize: 12, fontWeight: "700" }}>📍 Use current</P>
        </Pressable>
      </View>
      <Input
        t={t}
        placeholder="Search hotel, venue, airport, any place…"
        value={value ? value.label : q}
        onChangeText={onType}
        autoCapitalize="none"
      />
      {searching && <P t={t} soft style={{ fontSize: 12 }}>Searching…</P>}
      {!value &&
        hits.map((h, i) => (
          <Pressable
            key={i}
            onPress={() => { onChange({ label: h.label, lat: h.lat, lng: h.lng }); setHits([]); }}
            style={{ padding: 10, borderRadius: 10, borderWidth: 1, borderColor: t.edge, backgroundColor: t.card }}
          >
            <P t={t} style={{ fontSize: 14 }}>
              {h.kind === "SEARCH" ? "📍" : "⭐"} {h.label}
            </P>
          </Pressable>
        ))}
      {value ? <P t={t} style={{ color: t.ok, fontSize: 12 }}>✓ {value.label}</P> : null}
    </View>
  );
}
