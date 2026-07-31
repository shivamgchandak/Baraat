/**
 * Catch-all proxy to the backend. Attaches the Bearer token from the
 * httpOnly cookie; on 401 tries one refresh-token rotation transparently.
 * Pure passthrough — no business logic (thin-server rule).
 */
import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, backendUrl, type Session } from "@/lib/session";

async function forward(
  req: NextRequest,
  params: { path: string[] },
): Promise<NextResponse> {
  const raw = req.cookies.get(SESSION_COOKIE)?.value;
  if (!raw) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  let session: Session;
  try {
    session = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Bad session" }, { status: 401 });
  }

  const url = `${backendUrl()}/${params.path.join("/")}${req.nextUrl.search}`;
  const init = async (token: string): Promise<RequestInit> => ({
    method: req.method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(req.headers.get("content-type")
        ? { "content-type": req.headers.get("content-type")! }
        : {}),
    },
    body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.text(),
    cache: "no-store",
  });

  let res: Response;
  try {
    res = await fetch(url, await init(session.accessToken));
  } catch {
    return NextResponse.json(
      { error: "Backend unreachable — is the API running on :4000?" },
      { status: 502 },
    );
  }

  // One transparent refresh on expiry.
  let rotated: Session | null = null;
  if (res.status === 401) {
    try {
      const r = await fetch(`${backendUrl()}/auth/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
        cache: "no-store",
      });
      if (r.ok) {
        const j = await r.json();
        rotated = { ...session, accessToken: j.accessToken, refreshToken: j.refreshToken };
        res = await fetch(url, await init(rotated.accessToken));
      }
    } catch {
      // refresh attempt failed on network level — fall through with original 401
    }
  }

  const text = await res.text();
  const out = new NextResponse(text, {
    status: res.status,
    headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
  });
  if (rotated) {
    out.cookies.set(SESSION_COOKIE, JSON.stringify(rotated), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 12,
      path: "/",
    });
  }
  return out;
}

export async function GET(req: NextRequest, ctx: { params: { path: string[] } }) {
  return forward(req, ctx.params);
}
export async function POST(req: NextRequest, ctx: { params: { path: string[] } }) {
  return forward(req, ctx.params);
}
export async function PATCH(req: NextRequest, ctx: { params: { path: string[] } }) {
  return forward(req, ctx.params);
}
export async function DELETE(req: NextRequest, ctx: { params: { path: string[] } }) {
  return forward(req, ctx.params);
}
