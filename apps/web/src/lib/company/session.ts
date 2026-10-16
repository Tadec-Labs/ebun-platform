import { cookies } from "next/headers";

export const COMPANY_COOKIE = "ebun_company_token";

/**
 * A company's campaign link, kept in an httpOnly cookie after it's
 * opened once — same model as the vendor counter link (see
 * lib/vendor/session.ts): the token appears in a URL exactly once, then
 * stops turning up in history, referrers and logs.
 *
 * Scoped to /company so it never rides along on any other request.
 * Ninety days: long enough for a December campaign and its January
 * report; rotating the link from /ops is how it's revoked.
 */
export const COMPANY_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/company",
  maxAge: 60 * 60 * 24 * 90,
} as const;

export async function getCompanyToken(): Promise<string | null> {
  return (await cookies()).get(COMPANY_COOKIE)?.value ?? null;
}
