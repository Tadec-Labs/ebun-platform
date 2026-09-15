import { OrderStatus } from '@ebun/types';

/**
 * PROVISIONAL — built ahead of real mockups, at the person's own
 * request (backend first). `orderStatus` is included raw specifically
 * so the frontend isn't boxed in by whatever viewState buckets I
 * guessed at here; expect this shape to change once real designs
 * exist, hopefully by relaxing/extending rather than a rewrite.
 */
export type RevealViewState = 'not_ready' | 'ready' | 'expired' | 'unavailable';

export interface RevealView {
  viewState: RevealViewState;
  orderStatus: OrderStatus;
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
}
