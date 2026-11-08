/**
 * Supabase Auth over plain HTTP, server-side only (SUPABASE_URL and
 * SUPABASE_ANON_KEY are not NEXT_PUBLIC_): the browser never talks to
 * Supabase directly, as with /ops.
 */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

function config(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  return url && key ? { url: url.replace(/\/+$/, ""), key } : null;
}

export function authConfigured(): boolean {
  return config() !== null;
}

function tokens(body: unknown): AuthTokens | null {
  const b = body as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  } | null;
  if (!b?.access_token || !b.refresh_token) return null;
  return {
    accessToken: b.access_token,
    refreshToken: b.refresh_token,
    expiresIn: b.expires_in ?? 3600,
  };
}

async function post(path: string, body: unknown): Promise<Response | null> {
  const c = config();
  if (!c) return null;
  try {
    return await fetch(`${c.url}/auth/v1/${path}`, {
      method: "POST",
      headers: { apikey: c.key, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    return null;
  }
}

export async function passwordSignIn(
  email: string,
  password: string,
): Promise<AuthTokens | null> {
  const res = await post("token?grant_type=password", { email, password });
  if (!res?.ok) return null;
  return tokens(await res.json());
}

export async function refreshSession(
  refreshToken: string,
): Promise<AuthTokens | null> {
  const res = await post("token?grant_type=refresh_token", {
    refresh_token: refreshToken,
  });
  if (!res?.ok) return null;
  return tokens(await res.json());
}

/**
 * Creates the sign-in. Supabase emails a verification link that returns
 * to `redirectTo` (it must be in Supabase's allowed redirect URLs).
 * Returns tokens only when the project auto-confirms emails.
 */
export async function signUp(
  email: string,
  password: string,
  redirectTo: string,
): Promise<
  { ok: true; tokens: AuthTokens | null } | { ok: false; message: string }
> {
  const res = await post(
    `signup?redirect_to=${encodeURIComponent(redirectTo)}`,
    { email, password },
  );
  if (!res)
    return {
      ok: false,
      message: "Couldn't reach the sign-in service. Try again.",
    };
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const msg =
      (body as { msg?: string; message?: string } | null)?.msg ??
      (body as { message?: string } | null)?.message;
    // Supabase's own wording for weak passwords is useful; anything else stays generic.
    if (msg && /password/i.test(msg)) return { ok: false, message: msg };
    return {
      ok: false,
      message: "Couldn't create your sign-in. Check the details and try again.",
    };
  }
  return { ok: true, tokens: tokens(body) };
}
