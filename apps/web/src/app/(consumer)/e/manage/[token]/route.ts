import { NextResponse } from "next/server";
import { HOST_COOKIE_OPTIONS, hostCookieName, isHostToken, shortIdOf } from "@/lib/events/session";

/**
 * The host's private link, opened: remembers the token in this event's
 * own cookie and redirects to the clean /e/h/<short id> address, so the
 * token leaves the address bar after one request. Whether the token is
 * any good is the API's answer on the next request.
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isHostToken(token)) {
    return NextResponse.redirect(new URL("/events/new", request.url));
  }
  const shortId = shortIdOf(token);
  const response = NextResponse.redirect(new URL(`/e/h/${shortId}`, request.url));
  response.cookies.set(hostCookieName(shortId), token.toLowerCase(), HOST_COOKIE_OPTIONS);
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
