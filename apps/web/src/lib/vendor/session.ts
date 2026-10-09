import { cookies } from "next/headers";

export const VENDOR_COOKIE = "ebun_vendor_token";

/**
 * The counter link, kept in an httpOnly cookie after the vendor opens
 * it once.
 *
 * The token has to appear in a URL exactly once — the link you send the
 * vendor — and from then on it rides in a cookie instead, so it stops
 * turning up in browser history, referrer headers and proxy logs on
 * every subsequent request. httpOnly because a counter device runs
 * whatever the last person left open, and page JavaScript has no reason
 * to be able to read it.
 *
 * Long-lived on purpose: this is a device credential, not a login. A
 * vendor signed out mid-shift phones ops, which is the exact situation
 * the portal exists to end. Revocation is rotating the token from /ops,
 * not waiting for a cookie to lapse.
 */
export async function getVendorToken(): Promise<string | null> {
  return (await cookies()).get(VENDOR_COOKIE)?.value ?? null;
}

/**
 * Shared so the route handler that claims a link and anything that
 * later refreshes the cookie cannot drift apart on scope or lifetime —
 * a cookie written with a different path silently becomes a second
 * cookie rather than an update.
 */
export const VENDOR_COOKIE_OPTIONS = {
  httpOnly: true,
  // Plain http on localhost would drop a Secure cookie and make the
  // portal impossible to test locally.
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/vendor",
  maxAge: 60 * 60 * 24 * 365,
} as const;

export async function clearVendorToken() {
  (await cookies()).delete({ name: VENDOR_COOKIE, path: "/vendor" });
}
