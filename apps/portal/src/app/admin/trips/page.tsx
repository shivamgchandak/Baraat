"use client";

import { useState } from "react";
import { usePoll, api, fmtEta } from "@/lib/client";
import type { Overview, Upcoming } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";
import { LocationPicker, type PickedLocation } from "@/components/LocationPicker";

export default function TripsPage() {
  const { data: up, refresh: refreshUp } = usePoll<Upcoming>("/admin/upcoming", 5000);
  const { data: ov, refresh: refreshOv } = usePoll<Overview>("/admin/overview", 5000);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [overrideGuest, setOverrideGuest] = useState<string | null>(null);

  async function cancelTrip(id: string) {
    if (!confirm("Cancel this trip? Guests will be re-queued for automatic reassignment.")) return;
    setBusyId(id);
    await api(`/admin/override/cancel-trip/${id}`, { method: "POST" });
    await Promise.all([refreshUp(), refreshOv()]);
    setBusyId(null);
  }

  const refresh = async () => {
    await Promise.all([refreshUp(), refreshOv()]);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Trips</h1>

      <section>
        <h2 className="mb-2 font-semibold">
          Unmatched guests{" "}
          {up && up.unmatched.length > 0 && (
            <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
              {up.unmatched.length} waiting
            </span>
          )}
        </h2>
        {!up || up.unmatched.length === 0 ? (
          <p className="card py-4 text-center text-sm text-soft">
            Nobody is waiting — the engine has everyone covered. ✅
          </p>
        ) : (
          <ul className="space-y-2">
            {up.unmatched.map((g) => (
              <li key={g.id} className="card">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-semibold">
                      {g.priority && "⭐ "}
                      {g.user.name} <span className="text-xs font-normal text-soft">×{g.groupSize}</span>
                    </div>
                    <div className="text-sm text-soft">{g.pickupLabel ?? "No pickup point"}</div>
                  </div>
                  <button
                    onClick={() => setOverrideGuest(overrideGuest === g.id ? null : g.id)}
                    className="rounded-xl border border-edge bg-card px-4 py-2 text-sm font-semibold"
                  >
                    {overrideGuest === g.id ? "Close" : "Assign manually"}
                  </button>
                </div>
                {overrideGuest === g.id && ov && (
                  <OverrideForm
                    guestId={g.id}
                    drivers={ov.drivers.filter((d) => d.status !== "OFFLINE")}
                    minSeats={g.groupSize}
                    onDone={() => { setOverrideGuest(null); void refresh(); }}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Upcoming (assigned, not yet accepted)</h2>
        {!up || up.upcoming.length === 0 ? (
          <p className="card py-4 text-center text-sm text-soft">No upcoming trips.</p>
        ) : (
          <ul className="space-y-2">
            {up.upcoming.map((t) => (
              <li key={t.id} className="card flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium">
                    {t.driver.user.name} ({t.driver.vehicleNumber}) →{" "}
                    {t.tripGuests.map((tg) => tg.guest.user.name).join(", ")}
                  </div>
                  <div className="truncate text-sm text-soft">
                    {t.originLabel ?? "—"} → {t.destLabel ?? "—"} · ETA {fmtEta(t.etaSeconds)} ·{" "}
                    {t.type}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={t.status} />
                  <button
                    onClick={() => cancelTrip(t.id)}
                    disabled={busyId === t.id}
                    className="rounded-lg border border-rose-300 px-3 py-1.5 text-sm font-medium text-rose-600 dark:border-rose-700 dark:text-rose-400"
                  >
                    Cancel
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-semibold">In progress</h2>
        {!ov || ov.activeTrips.filter((t) => t.status !== "ASSIGNED").length === 0 ? (
          <p className="card py-4 text-center text-sm text-soft">No trips in progress.</p>
        ) : (
          <ul className="space-y-2">
            {ov.activeTrips
              .filter((t) => t.status !== "ASSIGNED")
              .map((t) => (
                <li key={t.id} className="card flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {t.driver.user.name} → {t.tripGuests.map((tg) => tg.guest.user.name).join(", ")}
                    </div>
                    <div className="truncate text-sm text-soft">
                      {t.originLabel ?? "—"} → {t.destLabel ?? "—"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={t.status} />
                    <button
                      onClick={() => cancelTrip(t.id)}
                      disabled={busyId === t.id}
                      className="rounded-lg border border-rose-300 px-3 py-1.5 text-sm font-medium text-rose-600 dark:border-rose-700 dark:text-rose-400"
                      title="Vehicle breakdown / emergency"
                    >
                      Cancel
                    </button>
                  </div>
                </li>
              ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function OverrideForm({
  guestId,
  drivers,
  minSeats,
  onDone,
}: {
  guestId: string;
  drivers: Overview["drivers"];
  minSeats: number;
  onDone: () => void;
}) {
  const [driverId, setDriverId] = useState("");
  const [dest, setDest] = useState<PickedLocation | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!dest) {
      setErr("Search and pick a destination first");
      return;
    }
    setBusy(true);
    setErr("");
    const res = await api<{ error?: unknown }>("/admin/override/assign", {
      method: "POST",
      body: JSON.stringify({
        guestId,
        driverId,
        type: "ON_DEMAND",
        destLat: dest.lat,
        destLng: dest.lng,
        destLabel: dest.label,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      setErr(typeof res.data?.error === "string" ? String(res.data.error) : "Could not assign");
      return;
    }
    onDone();
  }

  return (
    <form onSubmit={submit} className="mt-3 grid gap-3 border-t border-edge pt-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className="label">Driver (capacity shown — needs ≥ {minSeats} seats)</label>
        <select required className="input" value={driverId} onChange={(e) => setDriverId(e.target.value)}>
          <option value="">Choose a driver…</option>
          {drivers.map((d) => (
            <option key={d.id} value={d.id} disabled={d.seatCapacity < minSeats}>
              {d.user.name} · {d.vehicleNumber} · {d.seatCapacity} seats · {d.status}
            </option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-2">
        <label className="label">Destination *</label>
        <LocationPicker
          value={dest}
          onChange={setDest}
          placeholder="Search hotel, venue, or any place…"
          required
        />
      </div>
      {err && <p className="text-sm text-rose-600 sm:col-span-2">{err}</p>}
      <button type="submit" disabled={busy} className="btn-primary sm:col-span-2">
        {busy ? "Assigning…" : "Force assign"}
      </button>
    </form>
  );
}
