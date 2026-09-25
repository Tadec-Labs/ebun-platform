import { MOCK_CATALOG } from "./mock-data";
import type { GiftCatalogItem } from "./types";

/**
 * Unlike lib/reveal/get-reveal-view.ts, the real endpoint here
 * (GET /gifts, apps/api/src/gifts/gifts.controller.ts) already returns
 * exactly this shape — this is mock-first for iteration speed and
 * because the seed data behind it hasn't been run against a live
 * database from this environment, not because the contract is missing
 * anything. Real version will be:
 *   const res = await fetch(`${API_BASE_URL}/gifts`, { cache: "no-store" });
 *   if (!res.ok) throw new Error(...);
 *   return res.json();
 */
export async function getGiftCatalog(): Promise<GiftCatalogItem[]> {
  return MOCK_CATALOG;
}
