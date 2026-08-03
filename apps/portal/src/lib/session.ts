
import { cookies } from "next/headers";

export const SESSION_COOKIE = "baraat_session";

export interface Session {
  accessToken: string;
  refreshToken: string;
  role: "ADMIN" | "DRIVER" | "GUEST";
  name: string;
}

export function readSession(): Session | null {
  const raw = cookies().get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export function backendUrl(): string {
  return process.env.BACKEND_URL ?? "http://localhost:4000";
}
