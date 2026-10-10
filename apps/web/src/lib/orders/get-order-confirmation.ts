import { API_BASE_URL } from "@/lib/api-config";

/** Mirrors apps/api/src/orders/order-confirmation.ts exactly. */
export interface OrderConfirmation {
  status: "awaiting_payment" | "confirmed" | "unsuccessful";
  orderNumber: string | null;
  recipientName: string;
  /**
   * Only present once status is "confirmed", and withheld entirely
   * while a scheduled gift is still embargoed — the link IS the gift,
   * so handing it over early lets the sender spoil a surprise they
   * deliberately dated for later. A same-day stand-in for WhatsApp
   * delivery not being live yet, and a permanent safety net regardless.
   */
  revealUrl: string | null;
  /**
   * E.164. Present exactly when revealUrl is — used only to open a
   * WhatsApp chat with the recipient so the sender can send the link.
   */
  recipientPhone: string | null;
  /** Set when the sender chose to send later. Null means it went out immediately. */
  scheduledSendAt: string | null;
}

export type ConfirmationResult =
  | { kind: "ok"; data: OrderConfirmation }
  | { kind: "not_found" }
  | { kind: "error" };

/**
 * Asks the API for the order's real, webhook-derived status. The
 * `reference` in the page URL is only a lookup key — it's put there by
 * Paystack's redirect and proves nothing about whether payment
 * succeeded (anyone can type it into a URL), which is exactly why this
 * exists instead of the page just believing what it was handed.
 *
 * "error" (network failure, 5xx) and "not_found" are kept distinct:
 * the first is worth retrying while polling, the second is final.
 */
export async function getOrderConfirmation(
  reference: string,
): Promise<ConfirmationResult> {
  try {
    const res = await fetch(
      `${API_BASE_URL}/orders/confirmation/${encodeURIComponent(reference)}`,
      { cache: "no-store" },
    );
    if (res.status === 404) return { kind: "not_found" };
    if (!res.ok) return { kind: "error" };
    return { kind: "ok", data: (await res.json()) as OrderConfirmation };
  } catch {
    return { kind: "error" };
  }
}
