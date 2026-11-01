/**
 * Mirrors apps/api/src/events/events.service.ts. Amounts are kobo, as
 * everywhere else.
 */
import type { FeePolicy } from "@/lib/group/types";

export type EventType = "wedding" | "engagement" | "birthday" | "baby" | "send_forth" | "remembrance";
export type EventStatus = "active" | "closed" | "cancelled";

export interface EventItemView {
  /** The pot's public token: guests give or chip in at /group/<token>. */
  token: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  deliveryType: string;
  price: number;
  raised: number;
  remaining: number;
  contributorCount: number;
  status: "open" | "given" | "closed";
  givenBy: string[];
}

/** GET /events/:slug */
export interface EventPublicView {
  slug: string;
  eventType: EventType;
  title: string;
  eventDate: string;
  city: string;
  status: EventStatus;
  givingClosesAt: string;
  giftListEnabled: boolean;
  cashOpen: boolean;
  wallEnabled: boolean;
  showAmounts: boolean;
  guestCount: number;
  items: EventItemView[];
  minCash: number;
  serviceFee: FeePolicy;
}

/** GET /events/:slug/wall */
export interface WallEntry {
  id: string;
  kind: "cash" | "gift";
  name: string;
  message: string | null;
  amount: number | null;
  giftName: string | null;
  at: string;
}

export interface ThankYouEntry {
  id: string;
  kind: "cash" | "share";
  name: string;
  phone: string | null;
  message: string | null;
  amount: number;
  giftName: string | null;
  at: string;
  thanked: boolean;
}

/** GET /host/event */
export interface EventHostView {
  public: EventPublicView;
  sharePath: string;
  wallPath: string;
  hostName: string;
  cashRaised: number;
  cashCount: number;
  payoutDue: number;
  payout: {
    status: "none" | "paid";
    accountName: string | null;
    accountNumberMasked: string | null;
    bankCode: string | null;
    verified: boolean;
    paidAt: string | null;
    amount: number | null;
  };
  items: (EventItemView & { id: string; managePath: string; revealPath: string | null; awaitingAddress: boolean })[];
  delivery: { address: string; area: string; note: string | null } | null;
  deliveryAreas: string[];
  thankYous: ThankYouEntry[];
  canCancel: boolean;
  settings: { giftListEnabled: boolean; cashEnabled: boolean; wallEnabled: boolean; showAmounts: boolean };
  /** Whether SendEbun takes cash gifts at all yet. */
  cashAvailable: boolean;
}

export interface CreateEventPayload {
  eventType: EventType;
  title: string;
  eventDate: string;
  city: string;
  hostName: string;
  hostEmail: string;
  hostPhone: string;
  giftListEnabled: boolean;
  cashEnabled: boolean;
  wallEnabled: boolean;
  showAmounts: boolean;
}

export interface CreateEventResult {
  slug: string;
  sharePath: string;
  managePath: string;
}

export interface CashGiftPayload {
  name: string;
  email: string;
  phone?: string;
  amountNaira: number;
  message?: string;
  showOnWall: boolean;
  showAmount: boolean;
}

export interface CashGiftResult {
  checkoutUrl: string;
  amount: number;
  serviceFee: number;
  total: number;
}

/** GET /ops/events */
export interface OpsEventRow {
  id: string;
  slug: string;
  title: string;
  eventType: EventType;
  eventDate: string;
  status: EventStatus;
  hostName: string;
  cashRaised: number;
  cashCount: number;
  payoutDue: number;
  payoutStatus: "none" | "paid";
  accountName: string | null;
  bankCode: string | null;
  accountNumber: string | null;
  verified: boolean;
  readyToPay: boolean;
}
