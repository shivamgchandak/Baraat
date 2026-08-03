import React, { useEffect, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StatusBar, Text, View } from "react-native";
import { StatusBar as ExpoStatusBar } from "expo-status-bar";
import { api, hasSession } from "./src/api";
import { registerForPush } from "./src/push";
import { useTheme } from "./src/theme";
import { SignInScreen } from "./src/screens/SignIn";
import { RideScreen } from "./src/screens/Ride";
import { RequestScreen } from "./src/screens/Request";
import { HistoryScreen } from "./src/screens/History";
import { AccountScreen } from "./src/screens/Account";

type Tab = "ride" | "request" | "history" | "account";

interface Ctx {
  eventActive: boolean;
  eventPhase: "none" | "before" | "live" | "after" | "closed";
  eventName: string | null;
  startsAt: string | null;
  endsAt: string | null;
  hasActiveRide: boolean;
  waitingForDriver: boolean;
  hasPendingRequest: boolean;
}

const TABS: { key: Tab; icon: string; label: string }[] = [
  { key: "ride", icon: "🚘", label: "Ride" },
  { key: "request", icon: "🙋", label: "Request" },
  { key: "history", icon: "🧾", label: "History" },
  { key: "account", icon: "👤", label: "Account" },
];

export default function App() {
  const t = useTheme();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>("ride");
  const [ctx, setCtx] = useState<Ctx | null>(null);

  useEffect(() => {
    void hasSession().then(setSignedIn);
  }, []);

  useEffect(() => {
    if (signedIn) void registerForPush();
  }, [signedIn]);

  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    const load = async () => {
      const res = await api<Ctx>("/guests/me/context");
      if (alive && res.ok && res.data) setCtx(res.data);
    };
    void load();
    const id = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [signedIn]);

  if (signedIn === null) {
    return <View style={{ flex: 1, backgroundColor: t.surface }} />;
  }

  if (!signedIn) {
    return (
      <>
        <ExpoStatusBar style={t.dark ? "light" : "dark"} />
        <SignInScreen onSignedIn={() => setSignedIn(true)} />
      </>
    );
  }

  const eventActive = ctx?.eventActive ?? false;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.surface, paddingTop: StatusBar.currentHeight ?? 0 }}>
      <ExpoStatusBar style={t.dark ? "light" : "dark"} />

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 10 }}>
        <Text style={{ color: t.ink, fontSize: 18, fontWeight: "700" }}>🚘 Baraat</Text>
        {ctx?.eventName ? (
          <Text style={{ color: t.soft, fontSize: 12 }}>{ctx.eventName}</Text>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24 }}>
        {tab === "ride" && (
          <RideScreen
            eventActive={eventActive}
            waitingForDriver={ctx?.waitingForDriver ?? false}
            phase={ctx?.eventPhase ?? "none"}
            startsAt={ctx?.startsAt ?? null}
          />
        )}
        {tab === "request" && (
          <RequestScreen
            eventActive={eventActive}
            hasActiveRide={(ctx?.hasActiveRide ?? false) || (ctx?.waitingForDriver ?? false)}
            phase={ctx?.eventPhase ?? "none"}
            startsAt={ctx?.startsAt ?? null}
          />
        )}
        {tab === "history" && <HistoryScreen eventActive={eventActive} />}
        {tab === "account" && <AccountScreen onSignOut={() => setSignedIn(false)} />}
      </ScrollView>

      <View style={{ flexDirection: "row", borderTopWidth: 1, borderTopColor: t.edge, backgroundColor: t.card }}>
        {TABS.map((item) => {
          const active = tab === item.key;
          return (
            <Pressable key={item.key} onPress={() => setTab(item.key)} style={{ flex: 1, alignItems: "center", paddingVertical: 10 }}>
              <Text style={{ fontSize: 20 }}>{item.icon}</Text>
              <Text style={{ fontSize: 11, fontWeight: "600", color: active ? t.brand : t.soft, marginTop: 2 }}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}
