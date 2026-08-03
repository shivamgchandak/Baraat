
import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, backendUrl } from "@/lib/session";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json();
  let res: Response;
  try {
    res = await fetch(`${backendUrl()}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      { error: "Can't reach the server. Is the backend API running on :4000?" },
      { status: 502 },
    );
  }
  let json: { user?: { role: string; name: string }; accessToken?: string; refreshToken?: string; error?: unknown };
  try {
    json = await res.json();
  } catch {
    return NextResponse.json(
      { error: "The server sent an unexpected response. Check that the backend API is running." },
      { status: 502 },
    );
  }
  if (!res.ok) return NextResponse.json(json, { status: res.status });
  if (!json.user || !json.accessToken) {
    return NextResponse.json({ error: "Unexpected server response" }, { status: 502 });
  }

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
    maxAge: 60 * 60 * 12,
    path: "/",
  });
  return response;
}

export async function DELETE(): Promise<NextResponse> {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { maxAge: 0, path: "/" });
  return response;
}
