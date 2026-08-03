import { ThemeToggle } from "@/components/ThemeToggle";
import { LogoutButton } from "@/components/LogoutButton";
import { AdminNav } from "@/components/AdminNav";
import { readSession } from "@/lib/session";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = readSession();
  return (
    <div className="flex min-h-dvh">

      <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r border-edge bg-card px-3 py-4 md:flex">
        <div className="mb-6 px-2">
          <div className="text-lg font-bold">🚘 Baraat Ops</div>
          <div className="text-xs text-soft">{session?.name ?? "Operations"}</div>
        </div>
        <AdminNav orientation="vertical" />
        <div className="mt-auto flex items-center gap-2 px-2">
          <ThemeToggle />
          <LogoutButton />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">

        <header className="flex items-center justify-between border-b border-edge bg-card px-4 py-3 md:hidden">
          <div>
            <div className="font-bold leading-tight">🚘 Baraat Ops</div>
            <div className="text-xs text-soft">{session?.name ?? "Operations"}</div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <LogoutButton />
          </div>
        </header>

        <main className="flex-1 px-4 py-4 pb-24 md:px-6 md:pb-6">{children}</main>

        <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-edge bg-card md:hidden">
          <AdminNav orientation="horizontal" />
        </nav>
      </div>
    </div>
  );
}
