import { cookies } from "next/headers";

export const BIZ_ACCESS_COOKIE = "ebun_biz_token";
export const BIZ_REFRESH_COOKIE = "ebun_biz_refresh";

/**
 * A company member's sign-in, in two httpOnly cookies scoped to
 * /business, so no page script (and no other route) ever sees them.
 *
 * Unlike /ops this keeps Supabase's refresh token too: a company's
 * session shouldn't end every hour. When the access token runs out, the
 * page sends the visitor through /business/refresh, a route handler (the
 * only place besides server actions that may set cookies), which swaps
 * the refresh token for a new pair and returns them where they were.
 */
const base = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/business",
} as const;

export const REFRESH_MAX_AGE = 60 * 60 * 24 * 30;

export async function getBizToken(): Promise<string | null> {
  return (await cookies()).get(BIZ_ACCESS_COOKIE)?.value ?? null;
}

export async function hasBizRefresh(): Promise<boolean> {
  return Boolean((await cookies()).get(BIZ_REFRESH_COOKIE)?.value);
}

export function accessCookie(token: string, expiresIn: number) {
  return {
    name: BIZ_ACCESS_COOKIE,
    value: token,
    ...base,
    maxAge: Math.max(60, expiresIn - 60),
  };
}

export function refreshCookie(token: string) {
  return {
    name: BIZ_REFRESH_COOKIE,
    value: token,
    ...base,
    maxAge: REFRESH_MAX_AGE,
  };
}

export async function setBizSession(
  accessToken: string,
  refreshToken: string,
  expiresIn: number,
) {
  const jar = await cookies();
  jar.set(accessCookie(accessToken, expiresIn));
  jar.set(refreshCookie(refreshToken));
}

export async function clearBizSession() {
  const jar = await cookies();
  jar.delete({ name: BIZ_ACCESS_COOKIE, path: "/business" });
  jar.delete({ name: BIZ_REFRESH_COOKIE, path: "/business" });
}
