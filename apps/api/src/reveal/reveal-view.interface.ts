import { FulfillmentType, OrderStatus, RedemptionStatus } from '@ebun/types';

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
export type RevealViewState = 'not_ready' | 'ready' | 'expired' | 'unavailable';

export interface RevealView {
  viewState: RevealViewState;
  orderStatus: OrderStatus;
  fulfillmentType?: FulfillmentType;
  recipientName?: string;
  senderName?: string | null;
  giftName?: string;
  giftDescription?: string | null;
  giftImageUrl?: string | null;
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
  };
}
