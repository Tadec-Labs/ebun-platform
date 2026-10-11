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
  { kind: "ok"; items: GiftCatalogItem[] } | { kind: "unreachable" };

export async function getGiftCatalog(): Promise<GiftCatalogResult> {
  const url = `${API_BASE_URL}/gifts`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      logUnreachable(
        url,
        `the API answered ${res.status} ${res.statusText}`.trim(),
      );
      return { kind: "unreachable" };
    }
    return { kind: "ok", items: (await res.json()) as GiftCatalogItem[] };
  } catch (error) {
    logUnreachable(url, describeFetchError(error));
    return { kind: "unreachable" };
  }
}

/**
 * Server-side only (this runs in the /send server component), so it
 * lands in the terminal running the web app — never in the sender's
 * browser. Twice now "the gift list didn't load" has turned out to be
 * the API simply not running, and the old silent catch made that a
 * guessing game. One line now says which address was tried and what
 * came back.
 */
function logUnreachable(url: string, reason: string) {
  console.error(
    `[gift catalogue] Couldn't load ${url}: ${reason}. ` +
      "Is the API running (pnpm --filter api start:dev) and is NEXT_PUBLIC_API_BASE_URL right?",
  );
}

function describeFetchError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  // Node's fetch hides the useful part (ECONNREFUSED, ENOTFOUND,
  // ETIMEDOUT) one level down, on `cause`.
  const cause = (
    error as Error & { cause?: { code?: string; message?: string } }
  ).cause;
  if (cause?.code === "ECONNREFUSED")
    return "connection refused — nothing is listening there";
  if (cause?.code === "ENOTFOUND") return "that host name doesn't resolve";
  if (cause?.code)
    return `${cause.code}${cause.message ? ` (${cause.message})` : ""}`;
  return error.message;
}
