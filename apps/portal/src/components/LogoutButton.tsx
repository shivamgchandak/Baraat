"use client";

export function LogoutButton() {
  async function logout() {
    await fetch("/api/session", { method: "DELETE" });
    window.location.href = "/login";
  }
  return (
    <button
      onClick={logout}
      className="flex h-10 items-center justify-center rounded-lg border border-edge bg-card px-3 text-sm font-medium"
    >
      Sign out
    </button>
  );
}
