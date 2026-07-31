import { ThemeToggle } from "@/components/ThemeToggle";
import { LogoutButton } from "@/components/LogoutButton";
import { readSession } from "@/lib/session";

export default function DriverLayout({ children }: { children: React.ReactNode }) {
  const session = readSession();
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
      <header className="flex items-center justify-between px-4 py-3">
        <div>
          <div className="text-lg font-bold leading-tight">🚘 Baraat</div>
          <div className="text-xs text-soft">{session?.name ?? "Driver"}</div>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <LogoutButton />
        </div>
      </header>
      <main className="flex-1 px-4 pb-8">{children}</main>
    </div>
  );
}
