"use server";

import { API_BASE_URL } from "@/lib/api-config";
import { toPayload } from "@/lib/reveal/get-reveal-view";
import type { RevealPayload } from "@/lib/reveal/types";

export type ClaimResult =
  | { ok: true; payload: RevealPayload }
  | { ok: false; message: string };

/**
 * "Claim your gift" — POST /reveal/:token/accept, which creates the
 * recipient's redemption record and returns the same view shape GET
 * does, redemption included.
 *
 * A server action rather than a fetch from the component so the QR can
 * be rendered server-side in the same round trip (see lib/reveal/qr.ts)
 * and arrive with the response, instead of the browser downloading an
 * encoder to draw a picture of a token it was just handed.
 *
 * Returns a result instead of throwing: a failed claim should leave the
 * recipient looking at their gift with a message they can act on, not
 * at an error page — the gift is paid for and still theirs either way.
 * Accept is idempotent server-side, so retrying is safe.
 */
export async function claimGiftAction(token: string): Promise<ClaimResult> {
  let res: Response;
  try {
    res = await fetch(
      `${API_BASE_URL}/reveal/${encodeURIComponent(token)}/accept`,
      { method: "POST", cache: "no-store" },
    );
  } catch {
    return {
      ok: false,
      message: "Couldn't reach Ebun just then. Check your connection and try again.",
    };
  }

  if (res.status === 404 || res.status === 400) {
    return { ok: false, message: "This gift link is no longer valid." };
  }
  if (res.status === 429) {
    return { ok: false, message: "That was a lot of taps — give it a moment and try again." };
  }
  if (!res.ok) {
    return { ok: false, message: "Something went wrong claiming this gift. Try again in a moment." };
  }

  try {
    const view = (await res.json()) as Parameters<typeof toPayload>[0];
    return { ok: true, payload: await toPayload(view) };
  } catch {
    return { ok: false, message: "Something went wrong claiming this gift. Try again in a moment." };
  }
}
