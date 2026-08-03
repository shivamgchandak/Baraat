
import * as SecureStore from "expo-secure-store";

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";

const ACCESS_KEY = "baraat.access";
const REFRESH_KEY = "baraat.refresh";

export async function saveTokens(access: string, refresh: string): Promise<void> {
  await SecureStore.setItemAsync(ACCESS_KEY, access);
  await SecureStore.setItemAsync(REFRESH_KEY, refresh);
}

export async function clearTokens(): Promise<void> {
  await SecureStore.deleteItemAsync(ACCESS_KEY);
  await SecureStore.deleteItemAsync(REFRESH_KEY);
}

export async function hasSession(): Promise<boolean> {
  return (await SecureStore.getItemAsync(ACCESS_KEY)) !== null;
}

async function tryRefresh(): Promise<boolean> {
  const refresh = await SecureStore.getItemAsync(REFRESH_KEY);
  if (!refresh) return false;
  try {
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: refresh }),
    });
    if (!res.ok) return false;
    const j = await res.json();
    await saveTokens(j.accessToken, j.refreshToken);
    return true;
  } catch {
    return false;
  }
}

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T;
}

export async function api<T = unknown>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const call = async (): Promise<Response> => {
    const token = await SecureStore.getItemAsync(ACCESS_KEY);
    return fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  };

  try {
    let res = await call();
    if (res.status === 401 && (await tryRefresh())) res = await call();
    let data: T;
    try {
      data = (await res.json()) as T;
    } catch {
      data = null as T;
    }
    return { ok: res.ok, status: res.status, data };
  } catch {

    return { ok: false, status: 0, data: null as T };
  }
}

export async function login(
  email: string,
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const j = await res.json();
    if (!res.ok) return { ok: false, error: typeof j.error === "string" ? j.error : "Login failed" };
    if (j.user.role !== "GUEST") {
      return { ok: false, error: "This app is for guests — staff use the Ops portal" };
    }
    await saveTokens(j.accessToken, j.refreshToken);
    return { ok: true };
  } catch {
    return { ok: false, error: `Can't reach the server. Is EXPO_PUBLIC_API_URL right? (${API_URL})` };
  }
}

export function fmtEta(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  if (seconds < 60) return "<1 min";
  return `${Math.round(seconds / 60)} min`;
}
