import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { api } from "../api";
import { useTheme } from "../theme";
import { Badge, Card, H1, P } from "../components/UI";

interface PastRide {
  tripId: string;
  status: string;
  originLabel: string | null;
  destLabel: string | null;
  completedAt: string | null;
  driverName: string;
  vehicleNumber: string;
}

export function HistoryScreen({ eventActive }: { eventActive: boolean }) {
  const t = useTheme();
  const [rides, setRides] = useState<PastRide[] | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const res = await api<PastRide[]>("/guests/me/history");
      if (alive && res.ok) setRides(res.data ?? []);
    };
    void load();
    const id = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (!eventActive) {
    return (
      <Card t={t} style={{ alignItems: "center", gap: 6, paddingVertical: 30 }}>
        <P t={t} style={{ fontSize: 30 }}>📅</P>
        <P t={t} style={{ fontWeight: "700", fontSize: 16 }}>No active event</P>
        <P t={t} soft style={{ textAlign: "center" }}>There&apos;s no event running right now.</P>
      </Card>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      <H1 t={t}>Past rides</H1>
      {!rides ? (
        <Card t={t}><P t={t} soft>Loading…</P></Card>
      ) : rides.length === 0 ? (
        <Card t={t} style={{ alignItems: "center", paddingVertical: 24, gap: 4 }}>
          <P t={t} style={{ fontSize: 26 }}>🧾</P>
          <P t={t} soft>No completed rides yet.</P>
        </Card>
      ) : (
        rides.map((r) => (
          <Card t={t} key={r.tripId} style={{ gap: 6 }}>
            <View style={{ flexDirection: "row" }}>
              <Badge
                t={t}
                label={r.status}
                color={r.status === "COMPLETED" ? t.ok : "#e11d48"}
              />
            </View>
            <P t={t} style={{ fontWeight: "700" }}>
              {r.originLabel ?? "Pickup"} → {r.destLabel ?? "Drop"}
            </P>
            <P t={t} soft>
              {r.driverName} · {r.vehicleNumber}
              {r.completedAt ? ` · ${new Date(r.completedAt).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}
            </P>
          </Card>
        ))
      )}
    </View>
  );
}
