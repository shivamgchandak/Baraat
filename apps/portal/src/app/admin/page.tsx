"use client";

/** Ops dashboard: live fleet map + at-a-glance numbers. */
import { useState } from "react";
import { usePoll, api, timeAgo } from "@/lib/client";
import type { Overview } from "@/lib/types";
import { LiveMap } from "@/components/LiveMap";
import { StatusBadge } from "@/components/StatusBadge";
import { ConnLost } from "@/components/ConnLost";

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="card py-3 text-center">
      <div className={`text-2xl font-bold ${tone ?? ""}`}>{value}</div>
      <div className="text-xs text-soft">{label}</div>
    </div>
  );
}

interface EventState {
  status: "ACTIVE" | "CLOSED";
  name: string;
  closedAt: string | null;
}

function EventSwitch() {
  const { data: event, refresh } = usePoll<EventState>("/admin/event", 10000);
  const [busy, setBusy] = useState(false);

  async function setStatus(status: "ACTIVE" | "CLOSED") {
    const msg =
      status === "CLOSED"
        ? "End the event? Guests will no longer be able to raise ride requests. In-progress trips continue."
        : "Reopen the event? Guests will be able to raise ride requests again.";
    if (!confirm(msg)) return;
    setBusy(true);
    await api("/admin/event/status", { method: "POST", body: JSON.stringify({ status }) });
    await refresh();
    setBusy(false);
  }

  if (!event) return null;
  return event.status === "ACTIVE" ? (
    <button
      onClick={() => setStatus("CLOSED")}
      disabled={busy}
      className="rounded-xl border border-edge bg-card px-4 py-2 text-sm font-semibold"
    >
      🟢 Event live · End event
    </button>
  ) : (
    <button
      onClick={() => setStatus("ACTIVE")}
      disabled={busy}
      className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300"
    >
      🔴 Event ended · Reopen
    </button>
  );
}

export default function AdminDashboard() {
  const { data, error } = usePoll<Overview>("/admin/overview", 4000);

  if (!data) {
    if (error) return <ConnLost />;
    return <div className="card animate-pulse text-center text-soft">Loading dashboard…</div>;
  }

  const g = data.guests;
  const busyDrivers = data.drivers.filter((d) =>
    ["EN_ROUTE_PICKUP", "OCCUPIED"].includes(d.status),
  ).length;
  const idleDrivers = data.drivers.filter((d) => d.status === "IDLE").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Live operations</h1>
        <EventSwitch />
      </div>

      {/* Stats — 2 cols on phone, 6 on desktop */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Waiting" value={g.waiting.length} tone="text-amber-600 dark:text-amber-400" />
        <Stat label="Assigned" value={g.assigned.length} tone="text-sky-600 dark:text-sky-400" />
        <Stat label="In transit" value={g.inTransit.length} tone="text-violet-600 dark:text-violet-400" />
        <Stat label="Completed" value={g.completed.length} tone="text-emerald-600 dark:text-emerald-400" />
        <Stat label="Drivers busy" value={busyDrivers} />
        <Stat label="Drivers idle" value={idleDrivers} />
      </div>

      {data.pendingRequests.length > 0 && (
        <a
          href="/admin/requests"
          className="block rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300"
        >
          🙋 {data.pendingRequests.length} ride request
          {data.pendingRequests.length > 1 && "s"} waiting for your approval →
        </a>
      )}

      {/* Map + fleet list: stacked on phone, side-by-side on desktop */}
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="card h-[320px] p-1 sm:h-[420px]">
          <LiveMap
            drivers={data.drivers.map((d) => ({
              id: d.id,
              name: d.user.name,
              vehicleNumber: d.vehicleNumber,
              status: d.status,
              lat: d.currentLat,
              lng: d.currentLng,
            }))}
            waiting={g.waiting.map((w) => ({
              id: w.id,
              name: w.user.name,
              lat: w.pickupLat,
              lng: w.pickupLng,
            }))}
          />
        </div>

        <div className="card max-h-[420px] overflow-y-auto">
          <h2 className="mb-2 font-semibold">Fleet</h2>
          <ul className="space-y-2">
            {data.drivers.map((d) => (
              <li key={d.id} className="flex items-center justify-between rounded-lg bg-surface px-3 py-2">
                <div>
                  <div className="font-medium">{d.user.name}</div>
                  <div className="text-xs text-soft">
                    {d.vehicleNumber} · {d.seatCapacity} seats · loc {timeAgo(d.lastLocationAt)}
                  </div>
                </div>
                <StatusBadge status={d.status} />
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Active trips */}
      <div className="card">
        <h2 className="mb-2 font-semibold">Active trips ({data.activeTrips.length})</h2>
        {data.activeTrips.length === 0 ? (
          <p className="text-sm text-soft">No active trips.</p>
        ) : (
          <ul className="divide-y divide-edge">
            {data.activeTrips.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <div className="truncate font-medium">
                    {t.driver.user.name} → {t.tripGuests.map((tg) => tg.guest.user.name).join(", ")}
                  </div>
                  <div className="truncate text-xs text-soft">
                    {t.originLabel ?? "—"} → {t.destLabel ?? "—"}
                    {t.assignedBy === "ADMIN_OVERRIDE" && " · manual override"}
                  </div>
                </div>
                <StatusBadge status={t.status} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
