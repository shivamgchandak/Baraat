"use client";

/** On-demand ride requests: the human approve/decline decision. */
import { useState } from "react";
import { usePoll, api, timeAgo } from "@/lib/client";
import type { Overview } from "@/lib/types";

export default function RequestsPage() {
  const { data, refresh } = usePoll<Overview>("/admin/overview", 4000);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function decide(id: string, decision: "APPROVED" | "DECLINED") {
    setBusyId(id);
    await api(`/admin/requests/${id}/decide`, {
      method: "POST",
      body: JSON.stringify({ decision }),
    });
    await refresh();
    setBusyId(null);
  }

  const requests = data?.pendingRequests ?? [];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Ride requests</h1>
      <p className="text-sm text-soft">
        Approving hands the guest to the matching engine — it picks the driver automatically.
      </p>

      {requests.length === 0 ? (
        <div className="card py-10 text-center">
          <div className="text-3xl">✅</div>
          <p className="mt-2 font-semibold">No pending requests</p>
          <p className="text-sm text-soft">New guest requests will appear here instantly.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {requests.map((r) => (
            <li key={r.id} className="card">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-semibold">{r.guest.user.name}</div>
                  <div className="text-sm text-soft">
                    {r.guest.pickupLabel ?? "Pickup TBC"} · {r.guest.groupSize} pax ·{" "}
                    {timeAgo(r.requestedAt)}
                  </div>
                  {r.note && <p className="mt-1 rounded-lg bg-surface px-3 py-2 text-sm">“{r.note}”</p>}
                </div>
                <div className="flex w-full gap-2 sm:w-auto">
                  <button
                    onClick={() => decide(r.id, "APPROVED")}
                    disabled={busyId === r.id}
                    className="flex-1 rounded-xl bg-emerald-600 px-5 py-3 font-semibold text-white active:scale-95 disabled:opacity-50 sm:flex-none"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => decide(r.id, "DECLINED")}
                    disabled={busyId === r.id}
                    className="flex-1 rounded-xl border border-rose-300 px-5 py-3 font-semibold text-rose-600 active:scale-95 disabled:opacity-50 dark:border-rose-700 dark:text-rose-400 sm:flex-none"
                  >
                    Decline
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
