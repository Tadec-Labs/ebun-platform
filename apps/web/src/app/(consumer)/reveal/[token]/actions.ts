"use server";

import { API_BASE_URL } from "@/lib/api-config";
import { getRevealView, toPayload } from "@/lib/reveal/get-reveal-view";
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
      message: "Couldn't reach SendEbun just then. Check your connection and try again.",
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

export type BookPickupResult =
  | { ok: true; payload: RevealPayload }
  | { ok: false; message: string };

/**
 * "I'm coming at 12:30" — POST /reveal/:token/pickup. Returns the same
 * view as GET, now carrying the booking, so the screen shows what the
 * server actually stored rather than what it hoped to.
 */
export async function bookPickupAction(
  token: string,
  vendorId: string,
  pickupAt: string,
): Promise<BookPickupResult> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/reveal/${encodeURIComponent(token)}/pickup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vendorId, pickupAt }),
      cache: "no-store",
    });
  } catch {
    return {
      ok: false,
      message: "Couldn't reach SendEbun just then. Check your connection and try again.",
    };
  }

  if (res.status === 429) {
    return { ok: false, message: "That was a lot of taps — give it a moment and try again." };
  }
  if (!res.ok) {
    // The API words these for the recipient (wrong time, place can't
    // take it, gift moved on), so pass its message through.
    let message = "Couldn't book that. Try another time.";
    try {
      const body = (await res.json()) as { message?: unknown };
      if (typeof body.message === "string") message = body.message;
    } catch {
      // keep the generic message
    }
    return { ok: false, message };
  }

  try {
    const view = (await res.json()) as Parameters<typeof toPayload>[0];
    return { ok: true, payload: await toPayload(view) };
  } catch {
    return { ok: false, message: "Booked, but couldn't refresh the page. Reload to see it." };
  }
}

export type SetDeliveryResult =
  | { ok: true; payload: RevealPayload }
  | { ok: false; message: string };

/**
 * "Bring it here" — POST /reveal/:token/delivery. Returns the refreshed
 * view so the screen shows the delivery as the server now has it (and
 * who is preparing it), not what the form hoped to save.
 */
export async function setDeliveryAction(
  token: string,
  details: { address: string; area: string; phone: string; note: string },
): Promise<SetDeliveryResult> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/reveal/${encodeURIComponent(token)}/delivery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(details),
      cache: "no-store",
    });
  } catch {
    return {
      ok: false,
      message: "Couldn't reach SendEbun just then. Check your connection and try again.",
    };
  }

  if (res.status === 429) {
    return { ok: false, message: "That was a lot of taps — give it a moment and try again." };
  }
  if (!res.ok) {
    // Validation messages are written for the recipient ("Add the area,
    // e.g. Lekki Phase 1"), so show the first one as-is.
    let message = "Couldn't save that address. Check it and try again.";
    try {
      const body = (await res.json()) as { message?: unknown };
      if (typeof body.message === "string") message = body.message;
      else if (Array.isArray(body.message) && typeof body.message[0] === "string") message = body.message[0];
    } catch {
      // keep the generic message
    }
    return { ok: false, message };
  }

  try {
    const view = (await res.json()) as Parameters<typeof toPayload>[0];
    return { ok: true, payload: await toPayload(view) };
  } catch {
    return { ok: false, message: "Saved, but couldn't refresh the page. Reload to see it." };
  }
}

/**
 * Re-reads the gift for a page left open while a delivery is on its way,
 * so "it's here" appears without the recipient having to reload. Null on
 * any failure — the caller just tries again on its next tick.
 */
export async function refreshRevealAction(token: string): Promise<RevealPayload | null> {
  const result = await getRevealView(token);
  return result.kind === "ok" ? result.payload : null;
}
