import { NextResponse } from "next/server";
import {
  ORGANISER_COOKIE_OPTIONS,
  isOrganiserToken,
  organiserCookieName,
  shortIdOf,
} from "@/lib/group/session";

/**
 * The organiser's link, opened: remembers the token in this pot's own
 * cookie and redirects to the clean /group/m/<short id> address, so the
 * token leaves the address bar after one request. A route handler
 * because only route handlers and server actions may set cookies.
 * Whether the token is any good is the API's answer on the next request.
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isOrganiserToken(token)) {
    return NextResponse.redirect(new URL("/send", request.url));
  }
  const shortId = shortIdOf(token);
  const response = NextResponse.redirect(new URL(`/group/m/${shortId}`, request.url));
  response.cookies.set(organiserCookieName(shortId), token.toLowerCase(), ORGANISER_COOKIE_OPTIONS);
  // The address that held the token must not be sent on as a referrer.
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
