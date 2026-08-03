import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { Theme } from "../theme";

export function Card({ t, children, style }: { t: Theme; children: React.ReactNode; style?: object }) {
  return (
    <View
      style={[
        { backgroundColor: t.card, borderColor: t.edge, borderWidth: 1, borderRadius: 14, padding: 16 },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function H1({ t, children }: { t: Theme; children: React.ReactNode }) {
  return <Text style={{ color: t.ink, fontSize: 22, fontWeight: "700" }}>{children}</Text>;
}

export function P({ t, children, soft, style }: { t: Theme; children: React.ReactNode; soft?: boolean; style?: object }) {
  return <Text style={[{ color: soft ? t.soft : t.ink, fontSize: 15, lineHeight: 21 }, style]}>{children}</Text>;
}

export function Btn({
  t,
  label,
  onPress,
  kind = "primary",
  disabled,
  busy,
}: {
  t: Theme;
  label: string;
  onPress: () => void;
  kind?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  busy?: boolean;
}) {
  const bg = kind === "primary" ? t.brand : t.card;
  const color = kind === "primary" ? "#fff" : kind === "danger" ? "#e11d48" : t.ink;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.btn,
        {
          backgroundColor: bg,
          borderColor: kind === "primary" ? bg : t.edge,
          opacity: disabled || busy ? 0.5 : pressed ? 0.85 : 1,
        },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={color} />
      ) : (
        <Text style={{ color, fontSize: 17, fontWeight: "600" }}>{label}</Text>
      )}
    </Pressable>
  );
}

export function Input({
  t,
  ...props
}: { t: Theme } & React.ComponentProps<typeof TextInput>) {
  return (
    <TextInput
      placeholderTextColor={t.soft}
      style={{
        backgroundColor: t.card,
        borderColor: t.edge,
        borderWidth: 1,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 12,
        color: t.ink,
        fontSize: 16,
      }}
      {...props}
    />
  );
}

export function Badge({ t, label, color }: { t: Theme; label: string; color: string }) {
  return (
    <View style={{ backgroundColor: `${color}22`, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, alignSelf: "flex-start" }}>
      <Text style={{ color, fontSize: 12, fontWeight: "700" }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  btn: {
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
  },
});
