import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { login } from "../api";
import { useTheme } from "../theme";
import { Btn, Card, H1, Input, P } from "../components/UI";

export function SignInScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const t = useTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function doLogin() {
    setBusy(true);
    setError("");
    const res = await login(email.trim().toLowerCase(), password);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Login failed");
      return;
    }
    onSignedIn();
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: t.surface }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 20 }}>
        <View style={{ alignItems: "center", marginBottom: 28 }}>
          <Text style={{ fontSize: 44 }}>🚘</Text>
          <H1 t={t}>Baraat</H1>
          <P t={t} soft>Your event transport, handled</P>
        </View>

        <Card t={t} style={{ gap: 12 }}>
          <Input
            t={t}
            placeholder="Email"
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            value={email}
            onChangeText={setEmail}
          />
          <Input
            t={t}
            placeholder="Password"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
          {error ? <P t={t} style={{ color: "#e11d48" }}>{error}</P> : null}
          <Btn t={t} label="Sign in" onPress={doLogin} busy={busy} />
          <P t={t} soft style={{ textAlign: "center", fontSize: 13 }}>
            First time? Use the email your event coordinator registered and the password they
            shared with you. You can change it after signing in.
          </P>
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
