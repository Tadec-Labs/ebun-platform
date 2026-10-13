/** Mirrors apps/api/src/vendors/vendors.service.ts's views field-for-field. */

import {
  BOOKING_STYLES,
  GIFT_CATEGORIES,
  GIFT_CATEGORY_LABEL,
  OCCASIONS,
  OCCASION_LABEL,
  type BookingStyle,
  type GiftCategory,
  type Occasion,
} from "@ebun/types";

export type VendorCategory = GiftCategory;

export interface VendorSummary {
  id: string;
  businessName: string;
  ownerName: string;
  whatsappNumber: string;
  category: VendorCategory;
  serviceAreas: string[];
  deliveryZones: string[];
  active: boolean;
  verified: boolean;
  totalOrders: number;
  offeringsCount: number;
  /** Items the vendor asked to sell from their counter link, waiting on ops. */
  awaitingApprovalCount: number;
  createdAt: string;
}

export interface Vendor {
  id: string;
  businessName: string;
  ownerName: string;
  whatsappNumber: string;
  email: string | null;
  category: VendorCategory;
  subcategories: string[];
  serviceAreas: string[];
  deliveryZones: string[];
  /** The vendor's SHARE (0.70 = vendor receives 70%, Ebun keeps 30%) — despite the column name. */
  commissionRate: number;
  bankName: string | null;
  accountNumber: string | null;
  accountName: string | null;
  active: boolean;
  verified: boolean;
  totalOrders: number;
  responseTimeoutMinutes: number;
  backupVendorId: string | null;
  notes: string | null;
  /** Shown to recipients as where to collect. Null = not listed. */
  pickupAddress: string | null;
  pickupHours: string | null;
  /** The vendor's private counter-screen link. A credential — never log or share beyond the vendor. */
  portalToken: string;
  portalTokenRotatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Offering {
  giftTemplateId: string;
  giftName: string;
  senderPrice: number; // kobo
  vendorPrice: number; // kobo
  ebunMargin: number; // kobo
  ebunMarginPct: number;
  availableZones: string[];
  available: boolean;
  approved: boolean;
}

/** What every ops server action returns instead of throwing — errors are shown inline, not as a crash page. */
export type ActionResult =
  | { ok: true; message?: string }
  | { ok: false; errors: string[] };

/** One list, shared with the API and /send, so a category can't exist in one place and not another. */
export const VENDOR_CATEGORIES: { value: VendorCategory; label: string }[] = GIFT_CATEGORIES.map((value) => ({
  value,
  label: GIFT_CATEGORY_LABEL[value],
}));

export const OCCASION_OPTIONS: { value: Occasion; label: string }[] = OCCASIONS.map((value) => ({
  value,
  label: OCCASION_LABEL[value],
}));

export const BOOKING_STYLE_OPTIONS: { value: BookingStyle; label: string }[] = BOOKING_STYLES.map((value) => ({
  value,
  label: value === "pickup" ? "Walk in — collect any time they're open" : "Appointment — recipient books a slot",
}));

export type { BookingStyle, Occasion };

/** Mirrors apps/api/src/redemptions/redemptions.service.ts's RedemptionLookupView. */
export interface RedemptionLookup {
  code: string;
  redemptionNumber: string;
  status: "pending" | "initiated" | "completed" | "failed" | "expired";
  orderNumber: string | null;
  recipientName: string | null;
  giftName: string | null;
  expiresAt: string;
  completedAt: string | null;
  /** True only when a confirm would actually succeed right now. */
  redeemable: boolean;
  /** Plain-language reason it can't be collected, when redeemable is false. */
  blockedReason: string | null;
  /**
   * Active vendors that sell this gift — the only ones the API will
   * accept as having handed it over.
   */
  eligibleVendors: { id: string; name: string }[];
}

/** Mirrors apps/api/src/gifts/ops-gifts.service.ts's GiftTemplateView. */
export type GiftDeliveryType = "digital_voucher" | "physical" | "vtu";

export interface GiftTemplate {
  id: string;
  name: string;
  description: string | null;
  category: VendorCategory;
  basePrice: number; // kobo
  deliveryType: GiftDeliveryType | "experience";
  deliveryWindow: string | null;
  imageUrl: string | null;
  requiresAddress: boolean;
  available: boolean;
  featured: boolean;
  occasions: Occasion[];
  bookingStyle: BookingStyle;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Every delivery type a template can hold, including `experience`, which
 * can't be created. Labelling an existing one honestly is the point —
 * the edit form used to be unable to represent a type and silently
 * overwrote it.
 */
export const DELIVERY_TYPE_LABEL: Record<GiftTemplate["deliveryType"], string> = {
  digital_voucher: "Collected in person",
  physical: "Delivered to their door",
  vtu: "Sent to their phone",
  experience: "Booked experience — not fulfillable",
};

/**
 * The types the fulfilment orchestrator can complete (the API's
 * CREATABLE_DELIVERY_TYPES). Appointment-style gifts — spa, studio —
 * are "Collected in person" with Collection set to Appointment.
 */
export const GIFT_DELIVERY_TYPES: { value: GiftDeliveryType; label: string; hint: string }[] = [
  {
    value: "digital_voucher",
    label: "Collected in person",
    hint: "They get a code and collect it (or book a slot) at the vendor.",
  },
  {
    value: "physical",
    label: "Delivered to their door",
    hint: "Hampers, groceries, cakes, flowers. They give their address after opening it; the vendor delivers. The delivery fee (DELIVERY_FEE_KOBO, ₦1,500 by default) is added at checkout and goes to the vendor.",
  },
  {
    value: "vtu",
    label: "Sent to their phone",
    hint: "Airtime, data or bills — delivered automatically in seconds.",
  },
];

/* ------------------------------------------------------------------ */
/* Orders — mirrors apps/api/src/orders/ops-orders.service.ts          */
/* ------------------------------------------------------------------ */

/** Mirrors packages/types OrderStatus. Kept as a string union here rather than
 *  importing the enum: these values only ever arrive as JSON and get compared
 *  or rendered, and apps/web has no other reason to depend on @ebun/types. */
export type OrderStatusValue =
  | "draft"
  | "pending_payment"
  | "paid"
  | "processing"
  | "vendor_notified"
  | "vendor_accepted"
  | "vendor_declined"
  | "vendor_timeout"
  | "fulfillment_in_progress"
  | "dispatched"
  | "delivered"
  | "voucher_issued"
  | "ready_for_redemption"
  | "reveal_opened"
  | "redeemed"
  | "fulfilled"
  | "payment_failed"
  | "fulfillment_failed"
  | "redemption_failed"
  | "expired"
  | "cancelled"
  | "refunded";

export interface OrderSummary {
  id: string;
  orderNumber: string | null;
  status: OrderStatusValue;
  giftName: string | null;
  recipientName: string;
  recipientPhone: string;
  vendorName: string | null;
  totalAmount: number; // kobo
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  scheduledSendAt: string | null;
  stuck: boolean;
}

export interface OrderListResult {
  orders: OrderSummary[];
  total: number;
  limit: number;
  offset: number;
  stuckCount: number;
  stuckAfterMinutes: number;
}

export interface OrderEvent {
  id: string;
  eventType: string;
  actorType: "user" | "vendor" | "system" | "webhook" | "admin" | "cron";
  actorId: string | null;
  previousState: string | null;
  newState: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface OrderDetail extends OrderSummary {
  giftValue: number;
  deliveryFee: number;
  serviceFee: number;
  vendorPayoutAmount: number | null;
  vendorPaidAt: string | null;
  paystackReference: string | null;
  paymentVerifiedAt: string | null;
  /** Whether a message was attached and of what kind — never its contents. */
  messageType: "text" | "voice" | "video" | null;
  revealTheme: string;
  revealOpenedAt: string | null;
  whatsappSentAt: string | null;
  deliveryAddress: string | null;
  deliveryZone: string | null;
  isDiasporaSender: boolean;
  isCorporateOrder: boolean;
  senderCountryCode: string | null;
  notes: string | null;
  events: OrderEvent[];
  allowedTransitions: { normal: OrderStatusValue[]; adminOverride: OrderStatusValue[] };
  terminal: boolean;
  stuckAfterMinutes: number;
}

/**
 * Plain-language labels. The enum values are engineering vocabulary;
 * whoever is working the queue at 9pm should not have to translate
 * "ready_for_redemption" in their head.
 */
export const ORDER_STATUS_LABEL: Record<OrderStatusValue, string> = {
  draft: "Draft",
  pending_payment: "Awaiting payment",
  paid: "Paid",
  processing: "Processing",
  vendor_notified: "Vendor notified",
  vendor_accepted: "Vendor accepted",
  vendor_declined: "Vendor declined",
  vendor_timeout: "Vendor didn’t respond",
  fulfillment_in_progress: "Being fulfilled",
  dispatched: "Dispatched",
  delivered: "Delivered",
  voucher_issued: "Voucher issued",
  ready_for_redemption: "Ready to collect",
  reveal_opened: "Opened by recipient",
  redeemed: "Collected",
  fulfilled: "Done",
  payment_failed: "Payment failed",
  fulfillment_failed: "Fulfilment failed",
  redemption_failed: "Collection failed",
  expired: "Expired",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

export type StatusTone = "green" | "grey" | "amber" | "red" | "blue";

/**
 * Tone by what the state MEANS commercially, not by where it sits in
 * the graph: red is money taken and something broken, amber is waiting
 * on someone, green is money earned and the gift delivered.
 */
export const ORDER_STATUS_TONE: Record<OrderStatusValue, StatusTone> = {
  draft: "grey",
  pending_payment: "grey",
  paid: "blue",
  processing: "blue",
  vendor_notified: "amber",
  vendor_accepted: "blue",
  vendor_declined: "red",
  vendor_timeout: "red",
  fulfillment_in_progress: "blue",
  dispatched: "blue",
  delivered: "blue",
  voucher_issued: "amber",
  ready_for_redemption: "amber",
  reveal_opened: "amber",
  redeemed: "green",
  fulfilled: "green",
  payment_failed: "grey",
  fulfillment_failed: "red",
  redemption_failed: "red",
  expired: "red",
  cancelled: "grey",
  refunded: "grey",
};

/** Grouped for the filter UI, so the common questions are one click. */
export const ORDER_STATUS_GROUPS: { label: string; statuses: OrderStatusValue[] }[] = [
  { label: "Needs attention", statuses: ["fulfillment_failed", "redemption_failed", "vendor_declined", "vendor_timeout", "expired"] },
  { label: "In flight", statuses: ["paid", "processing", "vendor_notified", "vendor_accepted", "fulfillment_in_progress", "dispatched", "delivered"] },
  { label: "With the recipient", statuses: ["voucher_issued", "ready_for_redemption", "reveal_opened"] },
  { label: "Settled", statuses: ["redeemed", "fulfilled", "refunded", "cancelled"] },
  { label: "Never paid", statuses: ["draft", "pending_payment", "payment_failed"] },
];

/** Mirrors the API's OpsEarningsView. Amounts in kobo. */
export interface VendorEarnings {
  owedNow: number;
  paidTotal: number;
  collections: {
    orderId: string;
    orderNumber: string | null;
    giftName: string;
    amount: number;
    collectedAt: string;
    paid: boolean;
    paidAt: string | null;
  }[];
  payments: {
    id: string;
    amount: number;
    collections: number;
    paidAt: string | null;
    method: string | null;
    reference: string | null;
  }[];
  /** Exactly the collections to send when recording a payment. */
  unpaidOrderIds: string[];
}

/* ------------------------------------------------------------------ */
/* Deliveries — mirrors apps/api/src/deliveries/deliveries.service.ts  */
/* ------------------------------------------------------------------ */

export type OpsDeliveryStage =
  | "awaiting_address"
  | "needs_vendor"
  | "unacknowledged"
  | "preparing"
  | "on_the_way";

export interface OpsDelivery {
  orderId: string;
  orderNumber: string | null;
  giftName: string;
  recipientName: string;
  area: string | null;
  vendorId: string | null;
  vendorName: string | null;
  stage: OpsDeliveryStage;
  /** When it entered its current wait. */
  waitingSince: string;
}

export const DELIVERY_STAGE_LABEL: Record<OpsDeliveryStage, string> = {
  awaiting_address: "Waiting for address",
  needs_vendor: "Needs a vendor",
  unacknowledged: "Vendor hasn't seen it",
  preparing: "Being prepared",
  on_the_way: "On its way",
};
