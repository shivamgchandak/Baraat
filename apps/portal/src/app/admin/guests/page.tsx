"use client";

/** Guest management: list + add + manual corrections + priority flag. */
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
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("ALL");
  const [showAdd, setShowAdd] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

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

  async function reinvite(g: GuestRow) {
    setBusyId(g.id);
    const res = await api<{ inviteLink?: string; emailSent?: boolean }>(
      `/guests/${g.id}/reinvite`,
      { method: "POST", body: JSON.stringify({}) },
    );
    setBusyId(null);
    if (res.ok && res.data.inviteLink) {
      try {
        await navigator.clipboard.writeText(res.data.inviteLink);
        alert(
          res.data.emailSent
            ? "Invitation email sent again. Link also copied to clipboard."
            : "New invite link copied to clipboard — share it with the guest.",
        );
      } catch {
        alert(`Invite link:\n${res.data.inviteLink}`);
      }
    }
  }

  if (!guests && error) return <ConnLost />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Guests {guests && `(${guests.length})`}</h1>
        <button onClick={() => setShowAdd((v) => !v)} className="rounded-xl bg-brand-600 px-4 py-2.5 font-semibold text-white active:scale-95">
          {showAdd ? "Close" : "+ Add guest"}
        </button>
      </div>

      {showAdd && <AddGuestForm onDone={() => { setShowAdd(false); void refresh(); }} />}

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
          <li key={g.id} className="card flex flex-wrap items-center justify-between gap-2">
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
              {g.user.activatedAt ? null : (
                <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                  NOT ACTIVATED
                </span>
              )}
              <StatusBadge status={g.status} />
              {!g.user.activatedAt && (
                <button
                  onClick={() => reinvite(g)}
                  disabled={busyId === g.id}
                  className="rounded-lg border border-edge bg-card px-3 py-1.5 text-sm font-medium"
                  title="Send a fresh invitation link"
                >
                  Re-invite ✉️
                </button>
              )}
              <button
                onClick={() => togglePriority(g)}
                disabled={busyId === g.id}
                className="rounded-lg border border-edge bg-card px-3 py-1.5 text-sm font-medium"
                title="Toggle priority"
              >
                {g.priority ? "Unset ⭐" : "Set ⭐"}
              </button>
            </div>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="card py-8 text-center text-soft">No guests match.</li>
        )}
      </ul>
    </div>
  );
}

function AddGuestForm({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({
    name: "", email: "", phone: "", groupSize: "1", luggageCount: "0",
  });
  const [pickup, setPickup] = useState<PickedLocation | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState<{ link: string; emailSent: boolean } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const res = await api<{ error?: unknown; inviteLink?: string; emailSent?: boolean }>("/guests", {
      method: "POST",
      body: JSON.stringify({
        name: f.name,
        email: f.email,
        phone: f.phone || undefined,
        // no password: the guest sets their own via the invitation link
        pickupLabel: pickup?.label,
        pickupLat: pickup?.lat,
        pickupLng: pickup?.lng,
        groupSize: Number(f.groupSize),
        luggageCount: Number(f.luggageCount),
      }),
    });
    setBusy(false);
    if (!res.ok) {
      setErr(typeof res.data?.error === "string" ? String(res.data.error) : "Check the fields and try again");
      return;
    }
    if (res.data.inviteLink) {
      setInvite({ link: res.data.inviteLink, emailSent: Boolean(res.data.emailSent) });
    } else {
      onDone();
    }
  }

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));

  if (invite) {
    return (
      <div className="card space-y-3 text-center">
        <div className="text-3xl">✉️</div>
        <p className="font-semibold">Guest added — invitation ready</p>
        <p className="text-sm text-soft">
          {invite.emailSent
            ? "An invitation email was sent. They'll set their password via the link and sign in with their email."
            : "Email sending isn't configured, so share this activation link with the guest (WhatsApp/SMS works):"}
        </p>
        <div className="break-all rounded-lg bg-surface p-3 text-left text-xs">{invite.link}</div>
        <div className="flex gap-2">
          <button
            onClick={() => { void navigator.clipboard?.writeText(invite.link); }}
            className="btn-secondary"
          >
            Copy link
          </button>
          <button onClick={onDone} className="btn-primary">Done</button>
        </div>
      </div>
    );
  }

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
          placeholder="Search airport, station, or any place…"
        />
      </div>
      <div><label className="label">Group size</label><input className="input" inputMode="numeric" value={f.groupSize} onChange={set("groupSize")} /></div>
      <div><label className="label">Luggage</label><input className="input" inputMode="numeric" value={f.luggageCount} onChange={set("luggageCount")} /></div>
      {err && <p className="text-sm text-rose-600 sm:col-span-2">{err}</p>}
      <p className="text-xs text-soft sm:col-span-2">
        The guest receives an invitation to set their own password — no password to manage here.
      </p>
      <button type="submit" disabled={busy} className="btn-primary sm:col-span-2">
        {busy ? "Adding…" : "Add guest & send invite"}
      </button>
    </form>
  );
}
