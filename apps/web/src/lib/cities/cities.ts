import { API_BASE_URL } from "@/lib/api-config";

/** A city SendEbun is open in (GET /cities). */
export interface City {
  slug: string;
  name: string;
  state: string | null;
}

/**
 * Server-side, with the gift list. `null` means the list couldn't be
 * loaded (API down, or an API older than this page): the sender is told
 * to refresh, never quietly sent down "Somewhere else" as if their city
 * weren't served.
 */
export async function getCities(): Promise<City[] | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/cities`, { cache: "no-store" });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    return Array.isArray(body) ? (body as City[]) : null;
  } catch {
    return null;
  }
}

/** "akure", "Akure ", "AKURE" → the served city, if any. */
export function matchCity(cities: City[], typed: string): City | null {
  const wanted = typed.trim().toLowerCase();
  if (!wanted) return null;
  return cities.find((c) => c.name.toLowerCase() === wanted || c.slug === wanted.replace(/\s+/g, "-")) ?? null;
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
