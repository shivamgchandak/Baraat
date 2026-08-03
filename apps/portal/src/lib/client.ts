"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export async function api<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; data: T }> {
  let res: Response;
  try {
    res = await fetch(`/api/proxy${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...init?.headers,
      },
      cache: "no-store",
    });
  } catch {

    return { ok: false, status: 0, data: null as T };
  }
  let data: T;
  try {
    data = (await res.json()) as T;
  } catch {
    data = null as T;
  }
  if (res.status === 401 && typeof window !== "undefined") {
    window.location.href = "/login";
  }
  return { ok: res.ok, status: res.status, data };
}

export function usePoll<T>(path: string, ms = 4000): {
  data: T | null;
  error: boolean;
  refresh: () => Promise<void>;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    const res = await api<T>(path);
    if (res.ok) {
      setData(res.data);
      setError(false);
    } else {
      setError(true);
    }
  }, [path]);

  useEffect(() => {
    void refresh();
    timer.current = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, ms);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [refresh, ms]);

  return { data, error, refresh };
}

export function fmtEta(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  if (seconds < 60) return "<1 min";
  return `${Math.round(seconds / 60)} min`;
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return `${Math.max(1, Math.round(s))}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}
