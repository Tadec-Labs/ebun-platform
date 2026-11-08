import { NextResponse, type NextRequest } from "next/server";
import { refreshSession } from "@/lib/business/supabase-auth";
import {
  BIZ_ACCESS_COOKIE,
  BIZ_REFRESH_COOKIE,
  accessCookie,
  refreshCookie,
} from "@/lib/business/session";

/**
 * Swaps the refresh token for a fresh pair, then returns to `next`.
 * Only same-site /business paths are accepted as `next`, so this can't
 * be used to bounce someone to another site.
 */
export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("next") ?? "/business";
  const next =
    raw.startsWith("/business") && !raw.startsWith("//") ? raw : "/business";
  const refresh = request.cookies.get(BIZ_REFRESH_COOKIE)?.value;
  const tokens = refresh ? await refreshSession(refresh) : null;

  if (!tokens) {
    const out = NextResponse.redirect(
      new URL("/business/login?reason=session", request.url),
    );
    out.cookies.delete({ name: BIZ_ACCESS_COOKIE, path: "/business" });
    out.cookies.delete({ name: BIZ_REFRESH_COOKIE, path: "/business" });
    return out;
  }
  const out = NextResponse.redirect(new URL(next, request.url));
  out.cookies.set(accessCookie(tokens.accessToken, tokens.expiresIn));
  out.cookies.set(refreshCookie(tokens.refreshToken));
  return out;
}
