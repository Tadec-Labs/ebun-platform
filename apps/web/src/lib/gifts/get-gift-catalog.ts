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
 * On fetch failure, returns an empty array rather than falling back to
 * mock data — showing a "couldn't load gifts" state (see gift-selector.tsx)
 * is honest; silently serving fake catalog items that can't actually be
 * ordered is not.
 */
export async function getGiftCatalog(): Promise<GiftCatalogItem[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/gifts`, { cache: "no-store" });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    // Network error, API not reachable, etc. — same fallback as above.
    return [];
  }
}
