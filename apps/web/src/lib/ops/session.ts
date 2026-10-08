import { cookies } from "next/headers";

export const OPS_COOKIE = "ebun_ops_token";

/**
 * The staff access token lives in an httpOnly cookie, readable only by
 * server code — never by page JavaScript, so an XSS bug elsewhere can't
 * lift an admin session (these pages show vendor bank details). Scoped to
 * /ops so it isn't sent with consumer-route requests at all.
 *
 * It's the Supabase access token itself, which expires after an hour by
 * default; there's deliberately no refresh-token handling yet, so the
 * session ends then and the login page asks again. Raise the JWT expiry
 * in Supabase (Auth settings) if that proves annoying in practice.
 */
export async function getOpsToken(): Promise<string | null> {
  return (await cookies()).get(OPS_COOKIE)?.value ?? null;
}

export async function setOpsToken(token: string, maxAgeSecs: number) {
  (await cookies()).set(OPS_COOKIE, token, {
    httpOnly: true,
    // Plain http on localhost would drop a Secure cookie and make local
    // development impossible to log in to.
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/ops",
    maxAge: maxAgeSecs,
  });
}

export async function clearOpsToken() {
  (await cookies()).delete({ name: OPS_COOKIE, path: "/ops" });
}
