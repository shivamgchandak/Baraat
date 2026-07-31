/** Role gate: /admin only for ADMIN, /driver only for DRIVER. */
import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

export function middleware(req: NextRequest): NextResponse {
  const raw = req.cookies.get(SESSION_COOKIE)?.value;
  let role: string | null = null;
  if (raw) {
    try {
      role = (JSON.parse(raw) as { role: string }).role;
    } catch {
      role = null;
    }
  }

  const { pathname } = req.nextUrl;

  if (pathname === "/login") {
    if (role === "ADMIN") return NextResponse.redirect(new URL("/admin", req.url));
    if (role === "DRIVER") return NextResponse.redirect(new URL("/driver", req.url));
    return NextResponse.next();
  }

  if (!role) return NextResponse.redirect(new URL("/login", req.url));
  if (pathname.startsWith("/admin") && role !== "ADMIN") {
    return NextResponse.redirect(new URL("/driver", req.url));
  }
  if (pathname.startsWith("/driver") && role !== "DRIVER") {
    return NextResponse.redirect(new URL("/admin", req.url));
  }
  if (pathname === "/") {
    return NextResponse.redirect(new URL(role === "ADMIN" ? "/admin" : "/driver", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/login", "/admin/:path*", "/driver/:path*"],
};
