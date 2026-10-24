import { FulfillmentType, OrderStatus, RedemptionStatus } from '@ebun/types';
import type { RecipientDeliveryView } from '../deliveries/deliveries.service';

/**
 * PROVISIONAL — built ahead of real mockups, at the person's own
 * request (backend first). `orderStatus` is included raw specifically
 * so the frontend isn't boxed in by whatever viewState buckets I
 * guessed at here; expect this shape to change once real designs
 * exist, hopefully by relaxing/extending rather than a rewrite.
 *
 * `fulfillmentType` and `redemption` added once apps/web's reveal
 * screen (built against mock data first) made the gap concrete: the
 * UI has to branch on fulfillment type, and the digital_voucher
 * "claimed" screen needs the code/QR that acceptGift() was already
 * creating server-side but never returning. Deliberately still no new
 * viewState bucket for "claimed" — same reasoning as above: let the
 * frontend derive it from (orderStatus, fulfillmentType, redemption)
 * rather than encoding another guess into viewState.
 */
/**
 * 'choose' — a company gift where the company offered a few options and
 * the recipient hasn't picked yet. Shows `company.choices`; nothing else
 * about the gift exists until they choose.
 */
export type RevealViewState =
  'not_ready' | 'ready' | 'expired' | 'unavailable' | 'choose';

export interface RevealView {
  viewState: RevealViewState;
  orderStatus: OrderStatus;
  fulfillmentType?: FulfillmentType;
  recipientName?: string;
  senderName?: string | null;
  giftName?: string;
  giftDescription?: string | null;
  giftImageUrl?: string | null;
  /** Collected gifts: 'pickup' ("when are you collecting?") or 'appointment' ("book your appointment"). */
  bookingStyle?: 'pickup' | 'appointment';
  /** Collected gifts: the earliest bookable time is this many minutes from now (spa 6h, cinema 3h, food 0). */
  minNoticeMinutes?: number;
  /** Collected gifts: booked visits the shop marked "Didn't come". At 1 the page asks for a new time. */
  missedBookings?: number;
  theme?: string;
  message?: {
    type: 'text' | 'voice' | 'video';
    text?: string | null;
    playbackUrl?: string;
    durationSecs?: number | null;
  };
  /** digital_voucher only, and only while pending/initiated — see RevealService.buildView. */
  redemption?: {
    status: RedemptionStatus;
    fallbackCode: string;
    qrPayload: string;
    /** The redemption's own expiry, so the recipient's screen can say how long they have. */
    expiresAt: string;
  };
  /**
   * Where the code can be used — present exactly when `redemption` is.
   * Empty when no vendor offering this gift has a pickup address yet;
   * the screen says so rather than inventing somewhere. See
   * VendorsService.collectionPointsForGift for who is listed.
   */
  collectAt?: {
    vendorId: string;
    name: string;
    address: string;
    hours: string | null;
    whatsapp: string;
  }[];
  /**
   * digital_voucher, claimed, once the recipient has booked when they're
   * coming. `confirmed` is the vendor's "Got it, it'll be ready".
   */
  pickup?: {
    vendorId: string;
    placeName: string | null;
    whatsapp: string | null;
    at: string;
    confirmed: boolean;
  };
  /** physical only: where the delivery is, and where it's going. */
  delivery?: RecipientDeliveryView;
  /** physical, before delivery: there is a message, and it opens when the gift arrives. */
  messageLocked?: boolean;
  /**
   * digital_voucher only, once collected: when, and at which business.
   * Either can be null (older rows, a since-deleted vendor) — the screen
   * words around what it has.
   */
  collected?: { at: string | null; placeName: string | null };
  /** Gifts sent by a company campaign. */
  company?: {
    companyName: string;
    title: string;
    /** The recipient already sent their thank-you. */
    thanked: boolean;
    /** viewState 'choose' only: the company's options. */
    choices?: {
      giftTemplateId: string;
      name: string;
      description: string | null;
      imageUrl: string | null;
      deliveryType: string;
    }[];
  };
}
