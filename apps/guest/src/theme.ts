import { useColorScheme } from "react-native";

export function useTheme() {
  const dark = useColorScheme() === "dark";
  return {
    dark,
    surface: dark ? "#101014" : "#f8f8f6",
    card: dark ? "#1e1e24" : "#ffffff",
    edge: dark ? "#373740" : "#e4e2de",
    ink: dark ? "#f4f4f5" : "#18181b",
    soft: dark ? "#a1a1aa" : "#71717a",
    brand: "#c2405a",
    ok: "#10b981",
    warn: "#f59e0b",
    info: "#0ea5e9",
  };
}

export type Theme = ReturnType<typeof useTheme>;
