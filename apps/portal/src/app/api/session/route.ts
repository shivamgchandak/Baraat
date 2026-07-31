/** Login / logout — the only auth the browser talks to. No business logic. */
import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, backendUrl } from "@/lib/session";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json();
  const res = await fetch(`${backendUrl()}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const json = await res.json();
  if (!res.ok) return NextResponse.json(json, { status: res.status });

  if (json.user.role === "GUEST") {
    return NextResponse.json(
      { error: "Guests use the mobile app, not this portal" },
      { status: 403 },
    );
  }

  const response = NextResponse.json({ role: json.user.role, name: json.user.name });
  response.cookies.set(SESSION_COOKIE, JSON.stringify({
    accessToken: json.accessToken,
    refreshToken: json.refreshToken,
    role: json.user.role,
    name: json.user.name,
  }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 12, // event-day session
    path: "/",
  });
  return response;
}

export async function DELETE(): Promise<NextResponse> {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { maxAge: 0, path: "/" });
  return response;
}
