"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePoll } from "@/lib/client";

const LINKS = [
  { href: "/admin", label: "Dashboard", icon: "🗺️" },
  { href: "/admin/requests", label: "Requests", icon: "🙋" },
  { href: "/admin/trips", label: "Trips", icon: "🧭" },
  { href: "/admin/guests", label: "Guests", icon: "🧑‍🤝‍🧑" },
  { href: "/admin/drivers", label: "Drivers", icon: "🚖" },
];

export function AdminNav({ orientation }: { orientation: "vertical" | "horizontal" }) {
  const pathname = usePathname();
  const { data } = usePoll<{ pendingRequests: unknown[] }>("/admin/overview", 8000);
  const pending = data?.pendingRequests?.length ?? 0;

  if (orientation === "horizontal") {
    return (
      <div className="flex justify-around">
        {LINKS.map((l) => {
          const active = pathname === l.href;
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${active ? "text-brand-600" : "text-soft"}`}
            >
              <span className="text-xl leading-none">{l.icon}</span>
              {l.label}
              {l.href === "/admin/requests" && pending > 0 && (
                <span className="absolute right-1/4 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">
                  {pending}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {LINKS.map((l) => {
        const active = pathname === l.href;
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`flex items-center justify-between rounded-lg px-3 py-2.5 font-medium ${active ? "bg-brand-600/10 text-brand-600" : "text-ink hover:bg-surface"}`}
          >
            <span className="flex items-center gap-2.5">
              <span>{l.icon}</span> {l.label}
            </span>
            {l.href === "/admin/requests" && pending > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1.5 text-xs font-bold text-white">
                {pending}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
