const STYLES: Record<string, string> = {
  // driver
  IDLE: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  EN_ROUTE_PICKUP: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  OCCUPIED: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  ON_BREAK: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  OFFLINE: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  // guest
  WAITING: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  ASSIGNED: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  IN_TRANSIT: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  COMPLETED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  // trips / requests
  ACCEPTED: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  ARRIVED_PICKUP: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  BOARDED: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  PENDING: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  APPROVED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  DECLINED: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
  REJECTED: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
  CANCELLED: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${STYLES[status] ?? "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"}`}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}
