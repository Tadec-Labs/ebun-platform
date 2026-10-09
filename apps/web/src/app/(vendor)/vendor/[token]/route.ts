import { NextResponse } from "next/server";
import { VENDOR_COOKIE, VENDOR_COOKIE_OPTIONS } from "@/lib/vendor/session";

/**
 * The link a vendor is given, opened once.
 *
 * A ROUTE HANDLER, not a page: Next only allows cookies to be written
 * from a server action or a route handler, so a page that tried to
 * remember the token while rendering would throw — which is exactly
 * what the first version of this did. Setting the cookie on the
 * redirect response is both legal and a round trip shorter.
 *
 * The token leaves the address bar immediately, so what the vendor
 * bookmarks and uses from then on is the clean /vendor URL.
 *
 * No validation here on purpose: this only remembers what it was
 * handed. Whether the token identifies a live vendor is the API's
 * answer, and /vendor asks it on every load — so a link revoked after
 * it was saved is caught on use, not just on first open.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const response = NextResponse.redirect(new URL("/vendor", request.url));
  response.cookies.set(VENDOR_COOKIE, token, VENDOR_COOKIE_OPTIONS);
  return response;
}
