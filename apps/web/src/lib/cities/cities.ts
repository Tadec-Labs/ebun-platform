import { API_BASE_URL } from "@/lib/api-config";

/** A city SendEbun is open in (GET /cities). */
export interface City {
  slug: string;
  name: string;
  state: string | null;
}

/**
 * Server-side, with the gift list. An empty list (API down, or nothing
 * open yet) just means the picker offers "Somewhere else" on its own;
 * the gift list's own error message covers an unreachable API.
 */
export async function getCities(): Promise<City[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/cities`, { cache: "no-store" });
    if (!res.ok) return [];
    const body: unknown = await res.json();
    return Array.isArray(body) ? (body as City[]) : [];
  } catch {
    return [];
  }
}

/**
 * "They're somewhere you don't cover yet." Best effort: the sender's
 * screen thanks them either way, because a failed note to us is not
 * their problem to solve.
 */
export async function requestCity(input: { city: string; contact?: string }): Promise<void> {
  try {
    await fetch(`${API_BASE_URL}/cities/requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ city: input.city, contact: input.contact || undefined, source: "send" }),
    });
  } catch {
    // Ignored on purpose; see above.
  }
}
