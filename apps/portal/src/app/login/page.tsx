"use client";

import { useState } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(typeof json.error === "string" ? json.error : "Login failed");
      return;
    }
    window.location.href = json.role === "ADMIN" ? "/admin" : "/driver";
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="text-4xl">🚘</div>
          <h1 className="mt-2 text-2xl font-bold">Baraat</h1>
          <p className="mt-1 text-sm text-soft">Event dispatch portal</p>
        </div>
        <form onSubmit={submit} className="card space-y-4">
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@baraat.events"
            />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          {error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
              {error}
            </p>
          )}
          <button type="submit" disabled={busy} className="btn-primary">
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="mt-4 text-center text-xs text-soft">
          Operations team and drivers only. Guests use the Baraat app.
        </p>
      </div>
    </main>
  );
}
