import type { BookingStyle, FulfillmentType, GiftCategory, Occasion } from "@ebun/types";

/**
 * Mirrors apps/api's GiftCatalogItem (apps/api/src/gifts/gifts.service.ts)
 * field-for-field on purpose — unlike reveal's view model, this one CAN
 * match exactly, since GET /gifts already returns exactly what a
 * catalog screen needs. No known gaps here the way reveal had.
 */
export interface GiftCatalogItem {
  id: string;
  name: string;
  description: string | null;
  category: GiftCategory;
  /** Occasions ops tagged this gift for — drives the "For…" filter on /send. */
  occasions: Occasion[];
  /** pickup = collect any time in opening hours; appointment = book a slot (spa, studio). */
  bookingStyle: BookingStyle;
  imageUrl: string | null;
  basePrice: number; // kobo — the vendor's in-store price
  /** kobo — SendEbun's fee, shown as its own line before paying. */
  serviceFee: number;
  /** kobo — doorstep gifts only; 0 otherwise. Its own line at checkout. */
  deliveryFee: number;
  /** kobo — exactly what Paystack charges. Computed by the API, never here. */
  totalPrice: number;
  deliveryType: FulfillmentType;
  deliveryWindow: string | null;
  requiresAddress: boolean;
  featured: boolean;
  /** Airtime, data, power: no shop needed, so it reaches a recipient anywhere in Nigeria. */
  nationwide: boolean;
  /** Cities where a shop can hand this over today, who, and (doorstep gifts) which areas. */
  cities: GiftCityAvailability[];
}

export interface GiftCityAvailability {
  /** City slug, as in GET /cities. */
  city: string;
  /** Shop names, A–Z. Shown on the card so the sender knows who makes it. */
  sellers: string[];
  /** Doorstep gifts: areas shops in this city deliver to. Empty = not listed. */
  deliveryAreas: string[];
}

/** Whether a gift can reach a recipient in this city. */
export function availableIn(item: GiftCatalogItem, city: string): GiftCityAvailability | null {
  return item.cities?.find((c) => c.city === city) ?? null;
}
