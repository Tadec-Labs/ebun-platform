import { Injectable, NotFoundException } from '@nestjs/common';
import {
  GiftTemplateRow,
  GiftTemplatesRepository,
} from './gift-templates.repository';

/**
 * What GET /gifts actually returns — deliberately not the raw
 * GiftTemplateRow. Every current column happens to be safe to expose
 * (base_price IS the sender-facing price; vendor economics live in
 * vendor_gift_offerings, a different table this never touches), but
 * shaping the response explicitly means a column added to the table
 * later doesn't leak to the public catalog without a deliberate choice
 * to add it here too.
 */
export interface GiftCatalogItem {
  id: string;
  name: string;
  description: string | null;
  category: GiftTemplateRow['category'];
  imageUrl: string | null;
  basePrice: number; // kobo
  deliveryType: GiftTemplateRow['delivery_type'];
  deliveryWindow: string | null;
  requiresAddress: boolean;
  featured: boolean;
}

function toCatalogItem(template: GiftTemplateRow): GiftCatalogItem {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    category: template.category,
    imageUrl: template.image_url,
    basePrice: template.base_price,
    deliveryType: template.delivery_type,
    deliveryWindow: template.delivery_window,
    requiresAddress: template.requires_address,
    featured: template.featured,
  };
}

@Injectable()
export class GiftsService {
  constructor(private readonly repository: GiftTemplatesRepository) {}

  /** Backs GET /gifts. */
  async listAvailable(): Promise<GiftCatalogItem[]> {
    const templates = await this.repository.findAllAvailable();
    return templates.map(toCatalogItem);
  }

  /** Throws if the template doesn't exist OR exists but isn't currently available — CreateOrderService should never have to check `.available` itself. */
  async findAvailableById(id: string): Promise<GiftTemplateRow> {
    const template = await this.repository.findById(id);

    if (!template || !template.available) {
      throw new NotFoundException(
        `Gift template ${id} not found or not currently available`,
      );
    }

    return template;
  }

  /**
   * Deliberately does NOT check `.available` — that flag governs whether
   * a template can be selected for a NEW order, not whether an order
   * already paid for still deserves to be fulfilled. Fulfillment
   * orchestration needs the latter: look up delivery_type for an order
   * that already exists, regardless of whether the template was pulled
   * from the catalogue since. Still throws if the template row is
   * genuinely gone (a real data-integrity problem, not a normal case).
   */
  async findById(id: string): Promise<GiftTemplateRow> {
    const template = await this.repository.findById(id);

    if (!template) {
      throw new NotFoundException(`Gift template ${id} not found`);
    }

    return template;
  }
}
