"use client";

import { useState } from "react";
import { usePoll, api } from "@/lib/client";
import { LocationPicker, type PickedLocation } from "@/components/LocationPicker";

interface EventRow {
  id: string;
  name: string;
  status: "ACTIVE" | "CLOSED";
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  closedAt: string | null;
  _count: { guests: number; trips: number; accommodations: number };
}

function phaseOf(e: EventRow): { label: string; color: string } {
  const now = Date.now();
  if (e.status === "CLOSED") return { label: "ENDED", color: "zinc" };
  if (e.startsAt && now < new Date(e.startsAt).getTime()) return { label: "UPCOMING", color: "amber" };
  if (e.endsAt && now > new Date(e.endsAt).getTime()) return { label: "WINDOW PASSED", color: "amber" };
  return { label: "LIVE", color: "emerald" };
}

function fmtWindow(e: { startsAt: string | null; endsAt: string | null }): string {
  const f = (s: string | null) =>
    s ? new Date(s).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : null;
  const a = f(e.startsAt);
  const b = f(e.endsAt);
  if (a && b) return `${a} → ${b}`;
  if (a) return `from ${a}`;
  if (b) return `until ${b}`;
  return "no dates set (always open)";
}

export default function EventsPage() {
  const { data: events, refresh } = usePoll<EventRow[]>("/admin/events", 6000);
  const [showNew, setShowNew] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const active = events?.find((e) => e.status === "ACTIVE");
  const past = events?.filter((e) => e.status === "CLOSED") ?? [];

  async function closeEvent(id: string) {
    if (!confirm("End this event? Guests can no longer request rides and drivers can't accept new trips. It moves to Past events (read-only).")) return;
    setBusyId(id);
    await api(`/admin/events/${id}/close`, { method: "POST", body: JSON.stringify({}) });
    await refresh();
    setBusyId(null);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Events</h1>
        {!active && (
          <button onClick={() => setShowNew((v) => !v)} className="rounded-xl bg-brand-600 px-4 py-2.5 font-semibold text-white active:scale-95">
            {showNew ? "Close" : "+ New event"}
          </button>
        )}
      </div>

      {showNew && !active && <NewEventForm onDone={() => { setShowNew(false); void refresh(); }} />}

      <section>
        <h2 className="mb-2 font-semibold">Active event</h2>
        {active ? (
          <div className="card flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2 font-semibold">
                {active.name}
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                  {phaseOf(active).label}
                </span>
              </div>
              <div className="text-sm text-soft">🗓️ {fmtWindow(active)}</div>
              <div className="text-sm text-soft">
                {active._count.guests} guests · {active._count.trips} trips · {active._count.accommodations} accommodations
              </div>
            </div>
            <button
              onClick={() => closeEvent(active.id)}
              disabled={busyId === active.id}
              className="rounded-lg border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-600 dark:border-rose-700 dark:text-rose-400"
            >
              End event
            </button>
          </div>
        ) : (
          <div className="card py-6 text-center text-sm text-soft">
            No active event. Create one to start adding drivers, guests, and saved places.
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Past events ({past.length})</h2>
        {past.length === 0 ? (
          <p className="card py-4 text-center text-sm text-soft">No past events yet.</p>
        ) : (
          <ul className="space-y-2">
            {past.map((e) => (
              <li key={e.id} className="card flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-medium">🔴 {e.name}</div>
                  <div className="text-xs text-soft">🗓️ {fmtWindow(e)}</div>
                  <div className="text-xs text-soft">
                    {e._count.guests} guests · {e._count.trips} trips ·{" "}
                    ended {e.closedAt ? new Date(e.closedAt).toLocaleDateString() : "—"}
                  </div>
                </div>
                <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                  ARCHIVED · READ-ONLY
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-soft">Past events are kept for records and cannot be restarted.</p>
      </section>
    </div>
  );
}

function NewEventForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [venue, setVenue] = useState<PickedLocation | null>(null);
  const [airport, setAirport] = useState<PickedLocation | null>(null);
  const [station, setStation] = useState<PickedLocation | null>(null);
  const [hotels, setHotels] = useState<(PickedLocation | null)[]>([null]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setErr("Give the event a name"); return; }
    setBusy(true);
    setErr("");
    const places = [
      venue && { name: venue.label, kind: "VENUE", lat: venue.lat, lng: venue.lng },
      airport && { name: airport.label, kind: "AIRPORT", lat: airport.lat, lng: airport.lng },
      station && { name: station.label, kind: "STATION", lat: station.lat, lng: station.lng },
    ].filter(Boolean);
    const accommodations = hotels
      .filter((h): h is PickedLocation => h != null)
      .map((h) => ({ name: h.label, lat: h.lat, lng: h.lng }));
    const res = await api<{ error?: unknown }>("/admin/events", {
      method: "POST",
      body: JSON.stringify({
        name,
        startsAt: startsAt ? new Date(startsAt).toISOString() : undefined,
        endsAt: endsAt ? new Date(endsAt).toISOString() : undefined,
        places,
        accommodations,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      setErr(typeof res.data?.error === "string" ? String(res.data.error) : "Couldn't create event");
      return;
    }
    onDone();
  }

  return (
    <form onSubmit={submit} className="card space-y-3">
      <div>
        <label className="label">Event name *</label>
        <input required className="input" placeholder="Sharma Wedding — Kolhapur" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Starts at</label>
          <input type="datetime-local" className="input" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
        </div>
        <div>
          <label className="label">Ends at</label>
          <input type="datetime-local" className="input" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
        </div>
      </div>
      <p className="text-xs text-soft">Rides (guest requests, driver accepts) only work between these dates. Leave blank for always-open.</p>
      <p className="text-sm font-medium text-soft">Save important places (used when adding guests & for ride requests)</p>
      <div><label className="label">🎪 Venue</label><LocationPicker value={venue} onChange={setVenue} placeholder="Search the event venue…" /></div>
      <div><label className="label">✈️ Airport</label><LocationPicker value={airport} onChange={setAirport} placeholder="Search the airport…" /></div>
      <div><label className="label">🚉 Railway station</label><LocationPicker value={station} onChange={setStation} placeholder="Search the station…" /></div>
      <div>
        <label className="label">🏨 Accommodations</label>
        <div className="space-y-2">
          {hotels.map((h, i) => (
            <LocationPicker
              key={i}
              value={h}
              onChange={(v) => setHotels((prev) => prev.map((x, j) => (j === i ? v : x)))}
              placeholder={`Search hotel ${i + 1}…`}
            />
          ))}
          <button type="button" onClick={() => setHotels((p) => [...p, null])} className="btn-secondary">
            + Add another accommodation
          </button>
        </div>
      </div>
      {err && <p className="text-sm text-rose-600">{err}</p>}
      <button type="submit" disabled={busy} className="btn-primary">
        {busy ? "Creating…" : "Create event"}
      </button>
    </form>
  );
}
