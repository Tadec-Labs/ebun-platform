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
}
