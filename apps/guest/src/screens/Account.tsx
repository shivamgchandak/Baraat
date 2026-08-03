import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { api, clearTokens } from "../api";
import { useTheme } from "../theme";
import { Btn, Card, H1, Input, P } from "../components/UI";

interface Me {
  pickupLabel: string | null;
  flightTrainEta: string | null;
  pickupAt: string | null;
  groupSize: number;
  luggageCount: number;
  accommodation: { name: string } | null;
  dropLabel: string | null;
  user: { name: string; email: string };
}

export function AccountScreen({ onSignOut }: { onSignOut: () => void }) {
  const t = useTheme();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const res = await api<Me>("/guests/me");
      if (alive && res.ok && res.data) setMe(res.data);
    };
    void load();
    const id = setInterval(load, 20000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  async function signOut() {
    await clearTokens();
    onSignOut();
  }

  return (
    <View style={{ gap: 12 }}>
      <H1 t={t}>Account</H1>

      <Card t={t} style={{ gap: 10 }}>
        <Row t={t} icon="🧑" label="Name" value={me?.user.name ?? "—"} />
        <Row t={t} icon="✉️" label="Email" value={me?.user.email ?? "—"} />

        <Row t={t} icon="🧳" label="Group / luggage" value={me ? `${me.groupSize} people · ${me.luggageCount} bags` : "—"} />
      </Card>
      <P t={t} soft style={{ fontSize: 12, textAlign: "center" }}>
        These details are managed by the event team. Ask them to update anything that changed.
      </P>

      <ChangePassword />

      <Btn t={t} kind="secondary" label="Sign out" onPress={signOut} />
    </View>
  );
}

function ChangePassword() {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (next.length < 8) { setMsg({ text: "New password must be at least 8 characters", ok: false }); return; }
    if (next !== confirm) { setMsg({ text: "Passwords don't match", ok: false }); return; }
    setBusy(true);
    setMsg(null);
    const res = await api<{ error?: unknown }>("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword: current, newPassword: next }),
    });
    setBusy(false);
    if (!res.ok) {
      setMsg({ text: typeof res.data?.error === "string" ? String(res.data.error) : "Couldn't change password", ok: false });
      return;
    }
    setCurrent(""); setNext(""); setConfirm("");
    setMsg({ text: "Password changed ✓", ok: true });
  }

  return (
    <Card t={t} style={{ gap: 10 }}>
      <Btn t={t} kind="secondary" label={open ? "Hide change password" : "🔒 Change password"} onPress={() => { setOpen((v) => !v); setMsg(null); }} />
      {open && (
        <>
          <Input t={t} placeholder="Current password" secureTextEntry value={current} onChangeText={setCurrent} />
          <Input t={t} placeholder="New password (8+ characters)" secureTextEntry value={next} onChangeText={setNext} />
          <Input t={t} placeholder="Confirm new password" secureTextEntry value={confirm} onChangeText={setConfirm} />
          {msg ? <P t={t} style={{ color: msg.ok ? t.ok : "#e11d48" }}>{msg.text}</P> : null}
          <Btn t={t} label="Update password" onPress={submit} busy={busy} />
        </>
      )}
    </Card>
  );
}

function Row({ t, icon, label, value }: { t: ReturnType<typeof useTheme>; icon: string; label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
      <P t={t} style={{ fontSize: 18 }}>{icon}</P>
      <View style={{ flex: 1 }}>
        <P t={t} soft style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</P>
        <P t={t} style={{ fontWeight: "600" }}>{value}</P>
      </View>
    </View>
  );
}
