import { FulfillmentType, OrderStatus } from "@ebun/types";
import type { RevealPayload } from "./types";

/**
 * Keyed by a fake "token" so each scenario is reachable at its own URL
 * during development, e.g. /reveal/mock-physical-transit. See
 * get-reveal-view.ts for the fallback behaviour on an unrecognised
 * token, and dev-scenario-switcher.tsx for the on-screen picker.
 */
export const MOCK_SCENARIOS: Record<string, RevealPayload> = {
  "mock-voucher-ready": {
    screenState: "ready",
    orderStatus: OrderStatus.ReadyForRedemption,
    fulfillmentType: FulfillmentType.DigitalVoucher,
    recipientName: "Ada",
    senderName: "Segun",
    giftName: "A Pizza, On Him",
    giftDescription:
      "Redeemable at any partner pizza spot near you — pick your own toppings when you get there.",
    giftImageUrl: null,
    theme: "gold",
    message: {
      type: "voice",
      durationSecs: 14,
      playbackUrl: undefined,
    },
  },

  "mock-voucher-claimed": {
    screenState: "claimed",
    orderStatus: OrderStatus.ReadyForRedemption,
    fulfillmentType: FulfillmentType.DigitalVoucher,
    recipientName: "Ada",
    senderName: "Segun",
    giftName: "A Pizza, On Him",
    giftDescription: "Show this at the counter to collect it.",
    theme: "gold",
    message: { type: "voice", durationSecs: 14 },
    redemption: {
      fallbackCode: "EBN-7K2-9XQ",
      qrPayload: "ebun:redeem:mock-redemption-token-abc123",
      vendorHint: "Any Ebun founding-partner pizza spot — full list sent in your next message.",
      validUntil: "2026-10-23",
    },
  },

  "mock-voucher-redeemed": {
    screenState: "redeemed",
    orderStatus: OrderStatus.Redeemed,
    fulfillmentType: FulfillmentType.DigitalVoucher,
    recipientName: "Ada",
    senderName: "Segun",
    giftName: "A Pizza, On Him",
    theme: "gold",
  },

  "mock-physical-ready": {
    screenState: "ready",
    orderStatus: OrderStatus.RevealOpened,
    fulfillmentType: FulfillmentType.Physical,
    recipientName: "Chidi",
    senderName: "Ngozi",
    giftName: "A Burger, Delivered",
    giftDescription: "A full combo, delivered straight to your door — on the house.",
    theme: "gold",
    // Deliberately no `message` yet — the emotional message is withheld
    // for physical gifts until the item actually arrives.
  },

  "mock-physical-address": {
    screenState: "awaiting_address",
    orderStatus: OrderStatus.RevealOpened,
    fulfillmentType: FulfillmentType.Physical,
    recipientName: "Chidi",
    senderName: "Ngozi",
    giftName: "A Burger, Delivered",
    giftDescription: "A full combo, delivered straight to your door — on the house.",
    theme: "gold",
  },

  "mock-physical-transit": {
    screenState: "in_transit",
    orderStatus: OrderStatus.Dispatched,
    fulfillmentType: FulfillmentType.Physical,
    recipientName: "Chidi",
    senderName: "Ngozi",
    giftName: "A Burger, Delivered",
    theme: "gold",
    deliveryEtaLabel: "Arriving this evening",
  },

  "mock-physical-arrived": {
    screenState: "arrived",
    orderStatus: OrderStatus.Delivered,
    fulfillmentType: FulfillmentType.Physical,
    recipientName: "Chidi",
    senderName: "Ngozi",
    giftName: "A Burger, Delivered",
    theme: "gold",
    message: {
      type: "video",
      durationSecs: 22,
      playbackUrl: undefined,
    },
  },

  "mock-physical-fulfilled": {
    screenState: "fulfilled",
    orderStatus: OrderStatus.Fulfilled,
    fulfillmentType: FulfillmentType.Physical,
    recipientName: "Chidi",
    senderName: "Ngozi",
    giftName: "A Burger, Delivered",
    theme: "gold",
  },

  "mock-not-ready": {
    screenState: "not_ready",
    orderStatus: OrderStatus.Processing,
    fulfillmentType: FulfillmentType.DigitalVoucher,
  },

  "mock-expired": {
    screenState: "expired",
    orderStatus: OrderStatus.Expired,
    fulfillmentType: FulfillmentType.DigitalVoucher,
  },

  "mock-unavailable": {
    screenState: "unavailable",
    orderStatus: OrderStatus.Cancelled,
    fulfillmentType: FulfillmentType.DigitalVoucher,
  },
};

export const DEFAULT_MOCK_SCENARIO = "mock-voucher-ready";
