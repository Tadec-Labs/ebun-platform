import { FulfillmentType } from "@ebun/types";
import type { GiftCatalogItem } from "./types";

/**
 * Mirrors supabase/seed.sql's actual launch-catalog rows exactly (same
 * names, prices, copy) so switching to the real GET /gifts later is a
 * pure data-source swap — nothing about what's on screen should change
 * just because the source did.
 */
export const MOCK_CATALOG: GiftCatalogItem[] = [
  {
    id: "mock-pizza-voucher",
    name: "A Pizza, On Him",
    description:
      "Redeemable at any partner pizza spot near you — pick your own toppings when you get there.",
    category: "food",
    imageUrl: null,
    basePrice: 800000,
    deliveryType: FulfillmentType.DigitalVoucher,
    deliveryWindow: "Redeemable anytime this week",
    requiresAddress: false,
    featured: true,
  },
  {
    id: "mock-pizza-delivered",
    name: "A Pizza, Delivered",
    description: "A full pizza, delivered straight to their door.",
    category: "food",
    imageUrl: null,
    basePrice: 950000,
    deliveryType: FulfillmentType.Physical,
    deliveryWindow: "2-4hrs",
    requiresAddress: true,
    featured: true,
  },
  {
    id: "mock-burger-voucher",
    name: "A Burger, On Him",
    description:
      "Redeemable at any partner burger spot near you — fries and a drink included.",
    category: "food",
    imageUrl: null,
    basePrice: 600000,
    deliveryType: FulfillmentType.DigitalVoucher,
    deliveryWindow: "Redeemable anytime this week",
    requiresAddress: false,
    featured: false,
  },
  {
    id: "mock-burger-delivered",
    name: "A Burger, Delivered",
    description: "A full burger combo, delivered straight to their door.",
    category: "food",
    imageUrl: null,
    basePrice: 750000,
    deliveryType: FulfillmentType.Physical,
    deliveryWindow: "2-4hrs",
    requiresAddress: true,
    featured: false,
  },
];
