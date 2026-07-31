"use client";

/**
 * The driver's single screen. One trip at a time, one big button.
 * - Shows ONLY the driver's own trip (RBAC + RLS enforce this server-side).
 * - Live location auto-shared while online (geolocation watch).
 * - Big touch targets; glanceable next to a car.
 */
import { useEffect, useRef, useState } from "react";
import { api, fmtEta, usePoll } from "@/lib/client";
import { StatusBadge } from "@/components/StatusBadge";
import { ConnLost } from "@/components/ConnLost";

interface Me {
  id: string;
  status: "OFFLINE" | "IDLE" | "EN_ROUTE_PICKUP" | "OCCUPIED" | "ON_BREAK";
  vehicleNumber: string;
  seatCapacity: number;
  predictedFreeAt: string | null;
}

interface Trip {
  id: string;
  status: "ASSIGNED" | "ACCEPTED" | "ARRIVED_PICKUP" | "BOARDED" | "ARRIVED_DROP";
  originLabel: string | null;
  destLabel: string | null;
  etaSeconds: number | null;
  deadline: string | null;
  tripGuests: {
    guest: {
      groupSize: number;
      luggageCount: number;
      pickupLabel: string | null;
      user: { name: string; phone: string | null };
    };
  }[];
}

const NEXT_ACTION: Record<string, { to: string; label: string } | null> = {
  ASSIGNED: { to: "ACCEPTED", label: "Accept trip" },
  ACCEPTED: { to: "ARRIVED_PICKUP", label: "I've arrived at pickup" },
  ARRIVED_PICKUP: { to: "BOARDED", label: "Guest is on board" },
  BOARDED: { to: "ARRIVED_DROP", label: "Drop complete" },
};

export default function DriverPage() {
  const { data: me, error: meError, refresh: refreshMe } = usePoll<Me>("/drivers/me", 5000);
  const { data: trip, refresh: refreshTrip } = usePoll<Trip | null>("/drivers/me/trip", 4000);
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState(false);
  const watchRef = useRef<number | null>(null);

  // Continuous live location while online.
  useEffect(() => {
    const online = me && me.status !== "OFFLINE";
    if (online && watchRef.current === null && "geolocation" in navigator) {
      watchRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          setSharing(true);
          void api("/drivers/me/location", {
            method: "POST",
            body: JSON.stringify({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
          });
        },
        () => setSharing(false),
        { enableHighAccuracy: true, maximumAge: 5000 },
      );
    }
    if (!online && watchRef.current !== null) {
      navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
      setSharing(false);
    }
    return () => {
      if (watchRef.current !== null) {
        navigator.geolocation.clearWatch(watchRef.current);
        watchRef.current = null;
      }
    };
  }, [me]);

  async function setPresence(online: boolean) {
    setBusy(true);
    await api("/drivers/me/presence", { method: "POST", body: JSON.stringify({ online }) });
    await refreshMe();
    setBusy(false);
  }

  async function transition(to: string) {
    if (!trip) return;
    setBusy(true);
    await api(`/drivers/me/trip/${trip.id}/status`, {
      method: "POST",
      body: JSON.stringify({ status: to }),
    });
    await Promise.all([refreshTrip(), refreshMe()]);
    setBusy(false);
  }

  if (!me) {
    if (meError) return <ConnLost />;
    return <div className="card animate-pulse text-center text-soft">Loading…</div>;
  }

  const totalGuests = trip?.tripGuests.reduce((a, tg) => a + tg.guest.groupSize, 0) ?? 0;
  const totalLuggage = trip?.tripGuests.reduce((a, tg) => a + tg.guest.luggageCount, 0) ?? 0;
  const action = trip ? NEXT_ACTION[trip.status] : null;

  return (
    <div className="space-y-4">
      {/* status strip */}
      <div className="card flex items-center justify-between">
        <div>
          <div className="text-sm text-soft">{me.vehicleNumber}</div>
          <StatusBadge status={me.status} />
        </div>
        <div className="flex flex-col items-end gap-1">
          {me.status === "OFFLINE" ? (
            <button onClick={() => setPresence(true)} disabled={busy} className="rounded-xl bg-emerald-600 px-5 py-3 font-semibold text-white active:scale-95">
              Go online
            </button>
          ) : (
            <button onClick={() => setPresence(false)} disabled={busy || Boolean(trip)} className="rounded-xl border border-edge bg-card px-5 py-3 font-semibold active:scale-95 disabled:opacity-40">
              Go offline
            </button>
          )}
          {sharing && (
            <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> sharing location
            </span>
          )}
        </div>
      </div>

      {/* break state */}
      {me.status === "ON_BREAK" && (
        <div className="card border-amber-300 bg-amber-50 text-center dark:border-amber-700 dark:bg-amber-900/20">
          <div className="text-3xl">☕</div>
          <p className="mt-1 font-semibold">You&apos;re on a break</p>
          <p className="text-sm text-soft">
            Back in rotation{" "}
            {me.predictedFreeAt
              ? `at ${new Date(me.predictedFreeAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
              : "soon"}
            . No trips will be assigned until then.
          </p>
        </div>
      )}

      {/* trip card / idle state */}
      {trip ? (
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">Your trip</h2>
            <StatusBadge status={trip.status} />
          </div>

          <div className="space-y-3">
            <div className="flex gap-3">
              <div className="mt-1 flex flex-col items-center">
                <span className="h-3 w-3 rounded-full border-2 border-sky-500" />
                <span className="h-8 w-0.5 bg-edge" />
                <span className="h-3 w-3 rounded-full bg-brand-600" />
              </div>
              <div className="flex-1 space-y-3">
                <div>
                  <div className="text-xs uppercase tracking-wide text-soft">Pickup</div>
                  <div className="font-semibold">{trip.originLabel ?? "See map"}</div>
                  {trip.etaSeconds != null && trip.status !== "BOARDED" && (
                    <div className="text-sm text-soft">ETA {fmtEta(trip.etaSeconds)}</div>
                  )}
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-soft">Drop</div>
                  <div className="font-semibold">{trip.destLabel ?? "See map"}</div>
                </div>
              </div>
            </div>

            <div className="rounded-lg bg-surface p-3">
              <div className="text-xs uppercase tracking-wide text-soft">
                {trip.tripGuests.length > 1 ? `${trip.tripGuests.length} guests (shared ride)` : "Guest"}
              </div>
              {trip.tripGuests.map((tg, i) => (
                <div key={i} className="mt-1 flex items-center justify-between">
                  <div className="font-medium">{tg.guest.user.name}</div>
                  {tg.guest.user.phone && (
                    <a href={`tel:${tg.guest.user.phone}`} className="rounded-lg bg-brand-600/10 px-3 py-1.5 text-sm font-semibold text-brand-600 dark:text-brand-500">
                      📞 Call
                    </a>
                  )}
                </div>
              ))}
              <div className="mt-2 text-sm text-soft">
                {totalGuests} seat{totalGuests !== 1 && "s"} · {totalLuggage} bag{totalLuggage !== 1 && "s"}
              </div>
            </div>
          </div>

          {action && (
            <button onClick={() => transition(action.to)} disabled={busy} className="btn-primary">
              {busy ? "…" : action.label}
            </button>
          )}
          {trip.status === "ASSIGNED" && (
            <button onClick={() => transition("REJECTED")} disabled={busy} className="w-full py-2 text-center text-sm font-medium text-rose-600 dark:text-rose-400">
              Can&apos;t take this trip
            </button>
          )}
        </div>
      ) : (
        me.status !== "OFFLINE" &&
        me.status !== "ON_BREAK" && (
          <div className="card py-10 text-center">
            <div className="text-3xl">🕓</div>
            <p className="mt-2 font-semibold">No trip right now</p>
            <p className="mt-1 text-sm text-soft">
              You&apos;re in the queue. Your next trip appears here automatically — keep this page open.
            </p>
          </div>
        )
      )}

      {me.status === "OFFLINE" && !trip && (
        <div className="card py-10 text-center">
          <div className="text-3xl">💤</div>
          <p className="mt-2 font-semibold">You&apos;re offline</p>
          <p className="mt-1 text-sm text-soft">Go online to start receiving trips.</p>
        </div>
      )}
    </div>
  );
}
