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
  | "fulfilled" // physical: message opened — terminal, positive
  | "choose"; // company gift with options: the recipient picks before anything else

/** A gift sent by a company campaign. */
export interface CompanyGift {
  companyName: string;
  title: string;
  /** They already sent their thank-you. */
  thanked: boolean;
  /** "choose" only: the company's options. */
  choices?: {
    giftTemplateId: string;
    name: string;
    description: string | null;
    imageUrl: string | null;
    deliveryType: string;
  }[];
}

export interface RevealMessage {
  type: "text" | "voice" | "video";
  text?: string | null;
  playbackUrl?: string;
  durationSecs?: number | null;
}

/** Only ever populated once a digital_voucher order reaches "claimed". */
/** A place that will accept the code. Public business details only. */
export interface CollectionPoint {
  vendorId: string;
  name: string;
  address: string;
  hours: string | null;
  /** The business's WhatsApp, for "I'm coming at 12:30". */
  whatsapp: string;
}

/** When and where the recipient said they'll collect. */
export interface PickupBooking {
  vendorId: string;
  placeName: string | null;
  whatsapp: string | null;
  at: string; // ISO
  /** The vendor tapped "Got it, it'll be ready". */
  confirmed: boolean;
}

export interface RedemptionDetails {
  fallbackCode: string;
  qrPayload: string;
  validUntil?: string; // ISO date, display only
  /** Where the code can be used. Empty = no vendor with an address yet. */
  collectAt: CollectionPoint[];
}

export interface RevealPayload {
  screenState: RevealScreenState;
  orderStatus: OrderStatus;
  /**
   * Absent for not_ready / expired / unavailable: the API deliberately
   * returns nothing but the state for a link that isn't valid to view,
   * and those screens don't branch on fulfillment anyway.
   */
  fulfillmentType?: FulfillmentType;
  recipientName?: string;
  senderName?: string | null;
  giftName?: string;
  /** pickup = "when are you collecting?"; appointment = "book your appointment" (spa, studio). */
  bookingStyle?: "pickup" | "appointment";
  /** Collected gifts: earliest booking is this many minutes from now (spa 6h, cinema 3h, food 0). */
  minNoticeMinutes?: number;
  /** Collected gifts: booked visits the shop marked "Didn't come". */
  missedBookings?: number;
  giftDescription?: string | null;
  giftImageUrl?: string | null;
  theme?: "gold" | "red" | "white" | "green";
  message?: RevealMessage;
  redemption?: RedemptionDetails;
  /** digital_voucher, claimed, once a collection time is booked. */
  pickup?: PickupBooking;
  /** digital_voucher, once collected: when and where. Either may be null. */
  collected?: { at: string | null; placeName: string | null };
  /**
   * The redemption QR, pre-rendered to SVG on the server (see ./qr.ts)
   * so the encoder never reaches the browser bundle. Null when
   * rendering failed — the fallback code alone is enough to collect.
   */
  qrSvg?: string | null;
  /** Physical, in_transit only — e.g. "Arriving this evening". Display copy, not a timestamp to compute against. */
  deliveryEtaLabel?: string;
  /** Physical only: where the delivery is and where it's going. */
  delivery?: DeliveryDetails;
  /** Physical, before delivery: a message exists and opens when the gift arrives. Its content is not sent until then. */
  messageLocked?: boolean;
  /** Sent by a company campaign. */
  company?: CompanyGift;
}

/** Mirrors apps/api's RecipientDeliveryView (deliveries.service.ts). */
export interface DeliveryDetails {
  /** missed = the shop couldn't deliver; collect it there with the same code. */
  stage: "awaiting_address" | "preparing" | "on_the_way" | "missed" | "delivered";
  address: string | null;
  area: string | null;
  phone: string | null;
  note: string | null;
  placeName: string | null;
  riderName: string | null;
  riderPhone: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  window: string | null;
  canChangeAddress: boolean;
  /** The 4-digit code the recipient gives the rider at the door. Only ever on their own page. */
  handoverCode: string | null;
  /** They can tap "I've received it" themselves. */
  canConfirmReceived: boolean;
  /** Areas the shop delivers to. Not empty = pick from this list instead of typing. */
  areas: string[];
}

/**
 * The order's status, in this screen's vocabulary. Now the real
 * mapping used by get-reveal-view.ts, not the illustrative sketch it
 * started as — with one thing it structurally cannot answer: whether a
 * redemption record exists yet. "scratch this" and "here is your code"
 * are both orderStatus reveal_opened, so the caller layers that
 * distinction on top.
 *
 * hasDeliveryAddress comes from the API's delivery view: a doorstep
 * gift with an address is "on its way" (being prepared or with a
 * rider); without one, it starts at the scratch like any other gift and
 * asks for the address after.
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
    case OrderStatus.FulfillmentInProgress:
      // Doorstep gifts are viewable from payment: scratch first, then the
      // address. Any other type sitting here is mid-fulfilment.
      if (fulfillmentType !== FulfillmentType.Physical) return "not_ready";
      return hasDeliveryAddress ? "in_transit" : "ready";
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
