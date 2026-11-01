import { API_BASE_URL } from "@/lib/api-config";
import { readApiError } from "@/lib/group/api";
import { getHostToken } from "./session";

export class HostApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "HostApiError";
  }
}

type HostPath = "" | "/items" | `/items/${string}` | "/payout-account" | "/thanks" | "/cancel";

/**
 * Server-side only: calls the API as the host of the event whose short
 * id is in the page address, with the token from that event's cookie.
 * Null when there's no valid link — the page then explains how to get
 * back in rather than showing an error.
 */
export async function hostFetch<T>(
  shortId: string,
  path: HostPath,
  init: { method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"; body?: unknown } = {},
): Promise<T | null> {
  const token = await getHostToken(shortId);
  if (!token) return null;

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/host/event${path}`, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
    });
  } catch {
    throw new HostApiError("Couldn't reach SendEbun. Check your connection and try again.", 0);
  }

  if (res.status === 401) return null;
  if (!res.ok) throw new HostApiError(await readApiError(res), res.status);
  const text = await res.text();
  // 204s (settings, thanks, payout account) have no body: "done" is enough.
  return (text ? JSON.parse(text) : true) as T;
}

/** The host's full link, rebuilt on the server for "keep this link". */
export async function hostLinkPath(shortId: string): Promise<string | null> {
  const token = await getHostToken(shortId);
  return token ? `/e/manage/${token}` : null;
}
