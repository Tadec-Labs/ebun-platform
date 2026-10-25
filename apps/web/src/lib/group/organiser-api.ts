import { API_BASE_URL } from "@/lib/api-config";
import { readApiError } from "./api";
import { getOrganiserToken } from "./session";

export class OrganiserApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "OrganiserApiError";
  }
}

/**
 * Server-side only: calls the API as the organiser of the pot whose
 * short id is in the page address, with the token from that pot's
 * cookie. Returns null when there's no valid link — the page then says
 * "this link no longer works" rather than showing an error.
 */
export async function organiserFetch<T>(
  shortId: string,
  path: "" | "/extend" | "/switch" | "/cancel",
  init: { method?: "GET" | "POST"; body?: unknown } = {},
): Promise<T | null> {
  const token = await getOrganiserToken(shortId);
  if (!token) return null;

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/organiser/group-gift${path}`, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
    });
  } catch {
    throw new OrganiserApiError("Couldn't reach SendEbun. Check your connection and try again.", 0);
  }

  if (res.status === 401) return null;
  if (!res.ok) throw new OrganiserApiError(await readApiError(res), res.status);
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** The organiser's full link, rebuilt on the server for "keep this link". */
export async function organiserLinkPath(shortId: string): Promise<string | null> {
  const token = await getOrganiserToken(shortId);
  return token ? `/group/manage/${token}` : null;
}
