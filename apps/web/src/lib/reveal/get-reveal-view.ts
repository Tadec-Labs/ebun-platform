import { DEFAULT_MOCK_SCENARIO, MOCK_SCENARIOS } from "./mock-data";
import type { RevealPayload } from "./types";

/**
 * The one function this whole feature calls to get its data. Swapping
 * mock data for the real endpoint later means changing this function's
 * body only — every screen component takes a plain RevealPayload and
 * has no idea it came from a mock.
 *
 * Real version will be:
 *   const res = await fetch(`${API_BASE_URL}/reveal/${token}`, { cache: "no-store" });
 *   if (!res.ok) throw new Error(...);
 *   return res.json();
 * — the backend's RevealView now includes fulfillmentType and
 * redemption (see ./types.ts's header for what changed), so the two
 * contracts agree on those fields. What's still missing is anything
 * for the physical journey's address capture or arrival-triggered
 * reveal — that fulfillment path doesn't have a backend contract yet.
 *
 * Unrecognised tokens fall back to the happy-path voucher scenario
 * rather than 404ing, so any placeholder link dropped into the app
 * still renders something during review.
 */
export async function getRevealView(token: string): Promise<RevealPayload> {
  return MOCK_SCENARIOS[token] ?? MOCK_SCENARIOS[DEFAULT_MOCK_SCENARIO];
}
