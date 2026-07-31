"use client";

/** Fleet management: list with live status + manual driver onboarding. */
import { useState } from "react";
import { usePoll, api, timeAgo } from "@/lib/client";
import type { Overview } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";

export default function DriversPage() {
  const { data, refresh } = usePoll<Overview>("/admin/overview", 5000);
  const [showAdd, setShowAdd] = useState(false);

  const drivers = data?.drivers ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Drivers {data && `(${drivers.length})`}</h1>
        <button onClick={() => setShowAdd((v) => !v)} className="rounded-xl bg-brand-600 px-4 py-2.5 font-semibold text-white active:scale-95">
          {showAdd ? "Close" : "+ Onboard driver"}
        </button>
      </div>

      {showAdd && <AddDriverForm onDone={() => { setShowAdd(false); void refresh(); }} />}

      <ul className="grid gap-2 lg:grid-cols-2">
        {drivers.map((d) => (
          <li key={d.id} className="card flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="font-semibold">{d.user.name}</div>
              <div className="truncate text-sm text-soft">
                {d.vehicleNumber} · {d.seatCapacity} seats · {d.luggageCapacity} bags
                {d.user.phone && ` · ${d.user.phone}`}
              </div>
              <div className="text-xs text-soft">
                location {timeAgo(d.lastLocationAt)} · {d.tripsSinceBreak} trips since break
              </div>
            </div>
            <StatusBadge status={d.status} />
          </li>
        ))}
      </ul>
      <p className="text-xs text-soft">
        Drivers are onboarded manually by operations — there is no self-registration.
      </p>
    </div>
  );
}

function AddDriverForm({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({
    name: "", email: "", phone: "", password: "password123",
    vehicleNumber: "", seatCapacity: "4", luggageCapacity: "4",
  });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const res = await api<{ error?: unknown }>("/drivers", {
      method: "POST",
      body: JSON.stringify({
        name: f.name,
        email: f.email,
        phone: f.phone || undefined,
        password: f.password,
        vehicleNumber: f.vehicleNumber,
        seatCapacity: Number(f.seatCapacity),
        luggageCapacity: Number(f.luggageCapacity),
      }),
    });
    setBusy(false);
    if (!res.ok) {
      setErr(typeof res.data?.error === "string" ? String(res.data.error) : "Check the fields and try again");
      return;
    }
    onDone();
  }

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));

  return (
    <form onSubmit={submit} className="card grid gap-3 sm:grid-cols-2">
      <div><label className="label">Name *</label><input required className="input" value={f.name} onChange={set("name")} /></div>
      <div><label className="label">Email *</label><input required type="email" className="input" value={f.email} onChange={set("email")} /></div>
      <div><label className="label">Phone</label><input className="input" value={f.phone} onChange={set("phone")} /></div>
      <div><label className="label">Temp password *</label><input required className="input" value={f.password} onChange={set("password")} /></div>
      <div><label className="label">Vehicle number *</label><input required className="input" placeholder="DL1RT1009" value={f.vehicleNumber} onChange={set("vehicleNumber")} /></div>
      <div className="grid grid-cols-2 gap-2">
        <div><label className="label">Seats *</label><input required className="input" inputMode="numeric" value={f.seatCapacity} onChange={set("seatCapacity")} /></div>
        <div><label className="label">Luggage *</label><input required className="input" inputMode="numeric" value={f.luggageCapacity} onChange={set("luggageCapacity")} /></div>
      </div>
      {err && <p className="text-sm text-rose-600 sm:col-span-2">{err}</p>}
      <button type="submit" disabled={busy} className="btn-primary sm:col-span-2">
        {busy ? "Onboarding…" : "Onboard driver"}
      </button>
    </form>
  );
}
