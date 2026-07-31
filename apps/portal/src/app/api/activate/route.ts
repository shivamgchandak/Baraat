/** Public (pre-auth) passthroughs for the guest activation flow. */
import { NextRequest, NextResponse } from "next/server";
import { backendUrl } from "@/lib/session";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.json({ error: "token required" }, { status: 400 });
  try {
    const res = await fetch(`${backendUrl()}/auth/invite/${encodeURIComponent(token)}`, {
      cache: "no-store",
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ error: "Backend unreachable" }, { status: 502 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const res = await fetch(`${backendUrl()}/auth/activate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: await req.text(),
      cache: "no-store",
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ error: "Backend unreachable" }, { status: 502 });
  }
}
