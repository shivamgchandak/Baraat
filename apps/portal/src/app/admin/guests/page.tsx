"use client";

import { useMemo, useState } from "react";
import { usePoll, api } from "@/lib/client";
import type { OvGuest } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";
import { ConnLost } from "@/components/ConnLost";
import { LocationPicker, type PickedLocation } from "@/components/LocationPicker";

type GuestRow = OvGuest & {
  user: {
    name: string;
    phone: string | null;
    email?: string;
    activatedAt?: string | null;
    invitedAt?: string | null;
  };
};

const FILTERS = ["ALL", "WAITING", "ASSIGNED", "IN_TRANSIT", "COMPLETED"] as const;

export default function GuestsPage() {
  const { data: guests, error, refresh } = usePoll<GuestRow[]>("/guests", 6000);
  const { data: event } = usePoll<{ id: string; startsAt: string | null; endsAt: string | null } | null>("/admin/event", 10000);
  const noEvent = event === null;
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("ALL");
  const [showAdd, setShowAdd] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editPickup, setEditPickup] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let list = guests ?? [];
    if (filter !== "ALL") list = list.filter((g) => g.status === filter);
    if (q.trim()) {
      const needle = q.toLowerCase();
      list = list.filter((g) => g.user.name.toLowerCase().includes(needle));
    }
    return list;
  }, [guests, q, filter]);

  async function togglePriority(g: GuestRow) {
    setBusyId(g.id);
    await api(`/admin/override/priority/${g.id}`, {
      method: "POST",
      body: JSON.stringify({ priority: !g.priority }),
    });
    await refresh();
    setBusyId(null);
  }

  if (!guests && error) return <ConnLost />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Guests {guests && `(${guests.length})`}</h1>
        {!noEvent && (
          <button onClick={() => setShowAdd((v) => !v)} className="rounded-xl bg-brand-600 px-4 py-2.5 font-semibold text-white active:scale-95">
            {showAdd ? "Close" : "+ Add guest"}
          </button>
        )}
      </div>

      {noEvent && (
        <a href="/admin/events" className="block rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
          Create an event first, then add guests →
        </a>
      )}

      {showAdd && !noEvent && (
        <AddGuestForm
          startsAt={event?.startsAt ?? null}
          endsAt={event?.endsAt ?? null}
          onDone={() => { setShowAdd(false); void refresh(); }}
        />
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          className="input sm:max-w-xs"
          placeholder="Search by name…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="flex gap-1 overflow-x-auto">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${filter === f ? "bg-brand-600 text-white" : "border border-edge bg-card text-soft"}`}
            >
              {f.replaceAll("_", " ")}
            </button>
          ))}
        </div>
      </div>

      <ul className="space-y-2">
        {filtered.map((g) => (
          <li key={g.id} className="card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 font-semibold">
                  {g.priority && <span title="Priority guest">⭐</span>}
                  {g.user.name}
                  <span className="text-xs font-normal text-soft">×{g.groupSize}</span>
                </div>
                <div className="truncate text-sm text-soft">
                  {g.pickupLabel ?? "No pickup set"} → {g.accommodation?.name ?? "No hotel"}
                  {g.flightTrainEta &&
                    ` · ETA ${new Date(g.flightTrainEta).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={g.status} />
                <button
                  onClick={() => setEditPickup(editPickup === g.id ? null : g.id)}
                  className="rounded-lg border border-edge bg-card px-3 py-1.5 text-sm font-medium"
                  title="Set / change pickup location"
                >
                  📍 Pickup
                </button>
                <button
                  onClick={() => togglePriority(g)}
                  disabled={busyId === g.id}
                  className="rounded-lg border border-edge bg-card px-3 py-1.5 text-sm font-medium"
                  title="Toggle priority"
                >
                  {g.priority ? "Unset ⭐" : "Set ⭐"}
                </button>
              </div>
            </div>
            {editPickup === g.id && (
              <EditPickup
                guestId={g.id}
                current={g.pickupLabel}
                currentDrop={g.dropLabel ?? null}
                onDone={() => { setEditPickup(null); void refresh(); }}
              />
            )}
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="card py-8 text-center text-soft">No guests match.</li>
        )}
      </ul>
    </div>
  );
}

function EditPickup({
  guestId,
  current,
  currentDrop,
  onDone,
}: {
  guestId: string;
  current: string | null;
  currentDrop: string | null;
  onDone: () => void;
}) {
  const [pickup, setPickup] = useState<PickedLocation | null>(null);
  const [drop, setDrop] = useState<PickedLocation | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    if (!pickup && !drop) {
      setErr("Pick a new pickup and/or drop location");
      return;
    }
    setBusy(true);
    setErr("");
    const body: Record<string, unknown> = {};
    if (pickup) {
      body.pickupLat = pickup.lat;
      body.pickupLng = pickup.lng;
      body.pickupLabel = pickup.label;
    }
    if (drop) {
      body.dropLat = drop.lat;
      body.dropLng = drop.lng;
      body.dropLabel = drop.label;
    }
    const res = await api<{ error?: unknown }>(`/guests/${guestId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      setErr(typeof res.data?.error === "string" ? String(res.data.error) : "Couldn't update");
      return;
    }
    onDone();
  }

  return (
    <div className="mt-3 space-y-2 border-t border-edge pt-3">
      <label className="label">Pickup location {current ? `(current: ${current})` : ""}</label>
      <LocationPicker
        value={pickup}
        onChange={setPickup}
        placeholder="Search a place, or use 📍 current location…"
      />
      <label className="label">Drop location {currentDrop ? `(current: ${currentDrop})` : "(optional)"}</label>
      <LocationPicker
        value={drop}
        onChange={setDrop}
        placeholder="Search venue, hotel, or any place…"
      />
      {err && <p className="text-sm text-rose-600">{err}</p>}
      <button onClick={save} disabled={busy} className="btn-primary">
        {busy ? "Saving…" : "Save location(s)"}
      </button>
    </div>
  );
}

function toLocalInput(iso: string | null): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function AddGuestForm({ onDone, startsAt, endsAt }: { onDone: () => void; startsAt: string | null; endsAt: string | null }) {
  const [f, setF] = useState({
    name: "", email: "", phone: "", groupSize: "1", luggageCount: "0", pickupAt: "",
  });
  const [pickup, setPickup] = useState<PickedLocation | null>(null);
  const [drop, setDrop] = useState<PickedLocation | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const res = await api<{ error?: unknown }>("/guests", {
      method: "POST",
      body: JSON.stringify({
        name: f.name,
        email: f.email,
        phone: f.phone || undefined,
        pickupLabel: pickup?.label,
        pickupLat: pickup?.lat,
        pickupLng: pickup?.lng,
        dropLabel: drop?.label,
        dropLat: drop?.lat,
        dropLng: drop?.lng,
        groupSize: Number(f.groupSize),
        luggageCount: Number(f.luggageCount),
        pickupAt: f.pickupAt ? new Date(f.pickupAt).toISOString() : undefined,
        flightTrainEta: f.pickupAt ? new Date(f.pickupAt).toISOString() : undefined,
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
      <div><label className="label">Email * (they&apos;ll sign in with this)</label><input required type="email" className="input" value={f.email} onChange={set("email")} /></div>
      <div><label className="label">Phone</label><input className="input" value={f.phone} onChange={set("phone")} /></div>
      <div className="hidden sm:block" />
      <div className="sm:col-span-2">
        <label className="label">Pickup point</label>
        <LocationPicker
          value={pickup}
          onChange={setPickup}
          placeholder="Search airport, station, or any place in Kolhapur…"
        />
      </div>
      <div className="sm:col-span-2">
        <label className="label">Drop location (optional — defaults to their hotel)</label>
        <LocationPicker
          value={drop}
          onChange={setDrop}
          placeholder="Search venue, hotel, or any place in Kolhapur…"
        />
      </div>
      <div className="sm:col-span-2">
        <label className="label">Pickup date &amp; time (flight/train arrival)</label>
        <input
          type="datetime-local"
          className="input"
          value={f.pickupAt}
          min={toLocalInput(startsAt)}
          max={toLocalInput(endsAt)}
          onChange={set("pickupAt")}
        />
        {(startsAt || endsAt) && (
          <p className="mt-1 text-xs text-soft">Must be within the event window.</p>
        )}
      </div>
      <div><label className="label">Group size</label><input className="input" inputMode="numeric" value={f.groupSize} onChange={set("groupSize")} /></div>
      <div><label className="label">Luggage</label><input className="input" inputMode="numeric" value={f.luggageCount} onChange={set("luggageCount")} /></div>
      {err && <p className="text-sm text-rose-600 sm:col-span-2">{err}</p>}
      <p className="text-xs text-soft sm:col-span-2">
        The guest signs into the app with this email and the default password{" "}
        <b>guest123</b> (they can change it in the app).
      </p>
      <button type="submit" disabled={busy} className="btn-primary sm:col-span-2">
        {busy ? "Adding…" : "Add guest"}
      </button>
    </form>
  );
}
