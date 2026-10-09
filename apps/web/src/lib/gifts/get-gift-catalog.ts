import { API_BASE_URL } from "@/lib/api-config";
import type { GiftCatalogItem } from "./types";

/**
 * Real endpoint now (apps/api/src/gifts/gifts.controller.ts) — no
 * longer mock data. This has to be real, not mock: the gift IDs
 * flowing through this wizard end up in a real POST /orders call
 * later, and a mock ID like "mock-pizza-voucher" isn't a UUID the real
 * database has a row for. Mixing mock catalog data with a real order
 * submission would just produce a confusing 400 at the worst possible
 * moment (checkout), so this was wired for real before the payment
 * screen was, not after.
 *
 * Never falls back to mock data on failure: showing an honest error
 * beats silently serving fake catalog items that can't be ordered.
 *
 * Returns a result rather than a bare array because "the API is down"
 * and "nothing is on sale" are completely different problems with
 * completely different fixes, and collapsing both to [] told a sender
 * to check their connection when the real answer was that ops had not
 * put a single gift on sale yet. The sender sees different copy; so
 * does whoever is debugging it.
 */
export type GiftCatalogResult =
  | { kind: "ok"; items: GiftCatalogItem[] }
  | { kind: "unreachable" };

export async function getGiftCatalog(): Promise<GiftCatalogResult> {
  try {
    const res = await fetch(`${API_BASE_URL}/gifts`, { cache: "no-store" });
    if (!res.ok) return { kind: "unreachable" };
    return { kind: "ok", items: (await res.json()) as GiftCatalogItem[] };
  } catch {
    // Network error, API not reachable, wrong NEXT_PUBLIC_API_BASE_URL.
    return { kind: "unreachable" };
  }
}
