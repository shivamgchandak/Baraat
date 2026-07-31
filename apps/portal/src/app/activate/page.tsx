"use client";

/**
 * Guest account activation — reached from the invitation email link.
 * Sets the password once; afterwards the guest logs in (app or web)
 * with their email + this password.
 */
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ThemeToggle } from "@/components/ThemeToggle";

function ActivateInner() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [who, setWho] = useState<{ name: string; email: string } | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) {
      setInvalid(true);
      return;
    }
    void (async () => {
      const res = await fetch(`/api/activate?token=${encodeURIComponent(token)}`);
      if (res.ok) setWho(await res.json());
      else setInvalid(true);
    })();
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }
    setBusy(true);
    setError("");
    const res = await fetch("/api/activate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(typeof j.error === "string" ? j.error : "Activation failed — try again");
      return;
    }
    setDone(true);
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="text-4xl">🎉</div>
          <h1 className="mt-2 text-2xl font-bold">Welcome to Baraat</h1>
          <p className="mt-1 text-sm text-soft">Your event transport is arranged</p>
        </div>

        {invalid ? (
          <div className="card text-center">
            <p className="font-semibold">This invitation link isn&apos;t valid</p>
            <p className="mt-1 text-sm text-soft">
              It may have been used already. Ask the event&apos;s transport team to send you a new one.
            </p>
          </div>
        ) : done ? (
          <div className="card text-center">
            <div className="text-3xl">✅</div>
            <p className="mt-2 font-semibold">You&apos;re all set, {who?.name}!</p>
            <p className="mt-1 text-sm text-soft">
              Open the Baraat guest app and sign in with <b>{who?.email}</b> and your new
              password to see your pickup details.
            </p>
          </div>
        ) : !who ? (
          <div className="card animate-pulse text-center text-soft">Checking your invitation…</div>
        ) : (
          <form onSubmit={submit} className="card space-y-4">
            <p className="text-sm">
              Hi <b>{who.name}</b> — set a password for <b>{who.email}</b>. You&apos;ll use it
              every time you sign in.
            </p>
            <div>
              <label className="label" htmlFor="pw">New password</label>
              <input
                id="pw"
                type="password"
                required
                minLength={8}
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
              />
            </div>
            <div>
              <label className="label" htmlFor="pw2">Confirm password</label>
              <input
                id="pw2"
                type="password"
                required
                className="input"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Type it again"
              />
            </div>
            {error && (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
                {error}
              </p>
            )}
            <button type="submit" disabled={busy} className="btn-primary">
              {busy ? "Setting up…" : "Set password & activate"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}

export default function ActivatePage() {
  return (
    <Suspense fallback={null}>
      <ActivateInner />
    </Suspense>
  );
}
