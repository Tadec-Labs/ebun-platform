import { NextResponse } from "next/server";
import { COMPANY_COOKIE, COMPANY_COOKIE_OPTIONS } from "@/lib/company/session";

/**
 * The link a company is given, opened once: remembers the token in a
 * cookie and redirects to the clean /company URL. A route handler, not a
 * page, because only route handlers and server actions may set cookies.
 * Whether the token is any good is the API's answer on the next request.
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const response = NextResponse.redirect(new URL("/company", request.url));
  response.cookies.set(COMPANY_COOKIE, token, COMPANY_COOKIE_OPTIONS);
  return response;
}
