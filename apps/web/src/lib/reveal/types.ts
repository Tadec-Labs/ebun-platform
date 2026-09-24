import { FulfillmentType, OrderStatus } from "@ebun/types";

/**
 * Frontend view model for GET /reveal/:token.
 *
 * Was deliberately NOT the same shape as apps/api's RevealView
 * (apps/api/src/reveal/reveal-view.interface.ts) when this file was
 * first written — that interface was missing `fulfillmentType` and
 * `redemption`, which this screen needs to branch on and to render the
 * claimed/voucher state. Both have since been added server-side (same
 * gaps this comment used to describe), so the two contracts now agree
 * on those two fields. Still not wired to the real endpoint — see
 * get-reveal-view.ts — and the physical journey's delivery-address
 * capture and arrival-triggered reveal still have no backend contract
 * at all, since that fulfillment path is being built separately.
 * `awaiting_address` / `in_transit` / `arrived` below remain this UI's
 * best guess at what that work will need to produce.
 *
 * Once the real contract is settled end-to-end, promote the parts that
 * hold up to packages/types (order-status.ts's header already calls
 * that package "the single vocabulary both apps/api and apps/web
 * import from" — this file is upstream of that, not a replacement).
 */
export type RevealScreenState =
  | "not_ready" // token is real but the order hasn't reached a viewable state yet
  | "expired" // past expires_at, never opened/redeemed
  | "unavailable" // cancelled / refunded / failed — terminal, negative
  | "ready" // viewable, pre-claim/pre-address — the scratch moment lives here
  | "claimed" // digital_voucher: redemption code issued, not yet scanned
  | "redeemed" // digital_voucher: scanned by a vendor — terminal, positive
  | "awaiting_address" // physical: scratched, needs a delivery address
  | "in_transit" // physical: address confirmed, item + message both en route
  | "arrived" // physical: item delivered, full message unlockable
  | "fulfilled"; // physical: message opened — terminal, positive

export interface RevealMessage {
  type: "text" | "voice" | "video";
  text?: string | null;
  playbackUrl?: string;
  durationSecs?: number | null;
}

/** Only ever populated once a digital_voucher order reaches "claimed". */
export interface RedemptionDetails {
  fallbackCode: string;
  qrPayload: string;
  vendorHint?: string;
  validUntil?: string; // ISO date, display only
}

export interface RevealPayload {
  screenState: RevealScreenState;
  orderStatus: OrderStatus;
  fulfillmentType: FulfillmentType;
  recipientName?: string;
  senderName?: string | null;
  giftName?: string;
  giftDescription?: string | null;
  giftImageUrl?: string | null;
  theme?: "gold" | "red" | "white" | "green";
  message?: RevealMessage;
  redemption?: RedemptionDetails;
  /** Physical, in_transit only — e.g. "Arriving this evening". Display copy, not a timestamp to compute against. */
  deliveryEtaLabel?: string;
}

/**
 * Illustrative only — mock data below sets `screenState` directly rather
 * than deriving it, since the real inputs (order + redemption + address
 * presence) don't exist yet. Kept here so the mapping is written down
 * once, in one place, ahead of wiring the real endpoint — not because
 * anything currently calls it.
 */
export function deriveScreenState(
  orderStatus: OrderStatus,
  fulfillmentType: FulfillmentType,
  hasDeliveryAddress: boolean,
): RevealScreenState {
  switch (orderStatus) {
    case OrderStatus.Expired:
      return "expired";
    case OrderStatus.Cancelled:
    case OrderStatus.Refunded:
    case OrderStatus.FulfillmentFailed:
    case OrderStatus.RedemptionFailed:
      return "unavailable";
    case OrderStatus.Redeemed:
      return "redeemed";
    case OrderStatus.Fulfilled:
      return fulfillmentType === FulfillmentType.Physical ? "fulfilled" : "redeemed";
    case OrderStatus.Dispatched:
      return "in_transit";
    case OrderStatus.Delivered:
      return "arrived";
    case OrderStatus.VoucherIssued:
    case OrderStatus.ReadyForRedemption:
    case OrderStatus.RevealOpened:
      if (fulfillmentType !== FulfillmentType.Physical) return "ready";
      return hasDeliveryAddress ? "in_transit" : "awaiting_address";
    default:
      return "not_ready";
  }
}
