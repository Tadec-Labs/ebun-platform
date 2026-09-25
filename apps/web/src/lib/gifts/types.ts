import { FulfillmentType } from "@ebun/types";

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
  category: "food" | "experience" | "keepsake" | "utility";
  imageUrl: string | null;
  basePrice: number; // kobo
  deliveryType: FulfillmentType;
  deliveryWindow: string | null;
  requiresAddress: boolean;
  featured: boolean;
}
