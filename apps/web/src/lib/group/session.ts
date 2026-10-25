import { cookies } from "next/headers";

/**
 * The organiser's link, kept in an httpOnly cookie after it's opened
 * once — the same model as the company and vendor links: the token sits
 * in a URL exactly once, then stays out of history, referrers and logs.
 *
 * One cookie PER POT, unlike the company link: an organiser can run two
 * pots at once (a birthday and a send-forth), and opening the second
 * link mustn't lock them out of the first. The page address carries a
 * short id — the first 12 hex digits of the token — that only says which
 * cookie to read. On its own it opens nothing.
 *
 * Scoped to /group/m so it never rides along on any other request.
 * Sixty days: a 30-day pot, the 48-hour decision window, and the refunds
 * after.
 */
export const ORGANISER_COOKIE_PATH = "/group/m";

const SHORT_ID = /^[0-9a-f]{12}$/;
const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isOrganiserToken(token: string): boolean {
  return TOKEN.test(token);
}

export function shortIdOf(token: string): string {
  return token.replace(/-/g, "").slice(0, 12).toLowerCase();
}

export function organiserCookieName(shortId: string): string {
  return `ebun_group_${shortId}`;
}

export const ORGANISER_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: ORGANISER_COOKIE_PATH,
  maxAge: 60 * 60 * 24 * 60,
} as const;

/** The organiser token for this page, or null (no cookie, or a malformed id). */
export async function getOrganiserToken(shortId: string): Promise<string | null> {
  if (!SHORT_ID.test(shortId)) return null;
  const token = (await cookies()).get(organiserCookieName(shortId))?.value ?? null;
  // The cookie must belong to the id in the address — never a different pot's.
  return token && isOrganiserToken(token) && shortIdOf(token) === shortId ? token : null;
}
