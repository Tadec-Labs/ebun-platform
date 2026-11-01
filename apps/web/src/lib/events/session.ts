import { cookies } from "next/headers";

/**
 * The host's link, kept in an httpOnly cookie after it's opened once —
 * the same model as a pot organiser's: the token sits in a URL exactly
 * once, then stays out of history, referrers and logs. One cookie per
 * event (a host can run a wedding and a naming at once); the page
 * address carries only a short id saying which cookie to read.
 *
 * Scoped to /e/h. A year: an event can be set up months ahead, and the
 * host comes back after it for thank-yous and the payout.
 */
export const HOST_COOKIE_PATH = "/e/h";

const SHORT_ID = /^[0-9a-f]{12}$/;
const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isHostToken(token: string): boolean {
  return TOKEN.test(token);
}

export function shortIdOf(token: string): string {
  return token.replace(/-/g, "").slice(0, 12).toLowerCase();
}

export function hostCookieName(shortId: string): string {
  return `ebun_event_${shortId}`;
}

export const HOST_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: HOST_COOKIE_PATH,
  maxAge: 60 * 60 * 24 * 400,
} as const;

/** The host token for this page, or null (no cookie, or a malformed id). */
export async function getHostToken(shortId: string): Promise<string | null> {
  if (!SHORT_ID.test(shortId)) return null;
  const token = (await cookies()).get(hostCookieName(shortId))?.value ?? null;
  // The cookie must belong to the id in the address — never another event's.
  return token && isHostToken(token) && shortIdOf(token) === shortId ? token : null;
}
