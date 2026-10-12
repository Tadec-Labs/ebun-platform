import { Injectable, NotFoundException } from '@nestjs/common';
import { FulfillmentType } from '@ebun/types';
import { PricingService } from '../pricing/pricing.service';
import {
  GiftTemplateRow,
  GiftTemplatesRepository,
} from './gift-templates.repository';

/**
 * What GET /gifts actually returns — deliberately not the raw
 * GiftTemplateRow. Every current column happens to be safe to expose
 * (base_price IS the sender-facing price; vendor economics live in
 * vendor_gift_offerings, which this only checks for existence, never
 * prices), but
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
  basePrice: number; // kobo — the vendor's in-store price
  /** kobo — SendEbun's fee on top, shown as its own line at checkout. */
  serviceFee: number;
  /** kobo — exactly what Paystack will charge. */
  totalPrice: number;
  deliveryType: GiftTemplateRow['delivery_type'];
  deliveryWindow: string | null;
  requiresAddress: boolean;
  featured: boolean;
}

function toCatalogItem(
  template: GiftTemplateRow,
  pricing: PricingService,
): GiftCatalogItem {
  const price = pricing.priceGift(template.base_price);
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    category: template.category,
    imageUrl: template.image_url,
    basePrice: template.base_price,
    serviceFee: price.serviceFee,
    totalPrice: price.total,
    deliveryType: template.delivery_type,
    deliveryWindow: template.delivery_window,
    requiresAddress: template.requires_address,
    featured: template.featured,
  };
}

/**
 * Airtime, data and power go straight from the VTU provider to the
 * recipient — no counter, no vendor. Everything else is handed over by
 * a vendor and needs one.
 */
function needsVendor(template: GiftTemplateRow): boolean {
  return template.delivery_type !== FulfillmentType.Vtu;
}

function isSellable(
  template: GiftTemplateRow,
  templateIdsWithVendor: Set<string>,
): boolean {
  return !needsVendor(template) || templateIdsWithVendor.has(template.id);
}

@Injectable()
export class GiftsService {
  constructor(
    private readonly repository: GiftTemplatesRepository,
    private readonly pricing: PricingService,
  ) {}

  /**
   * Backs GET /gifts: on sale in the catalogue AND, for anything a
   * vendor hands over, at least one vendor able to do so today.
   *
   * The second condition is what stops SendEbun taking money for a gift
   * nobody can fulfil — no vendor signed yet, every vendor marked it sold
   * out, or the only vendor deactivated. The gift reappears by itself
   * the moment a vendor switches it back on.
   */
  async listAvailable(): Promise<GiftCatalogItem[]> {
    const [templates, withVendor] = await Promise.all([
      this.repository.findAllAvailable(),
      this.repository.findTemplateIdsWithAvailableVendor(),
    ]);
    return templates
      .filter((template) => isSellable(template, withVendor))
      .map((template) => toCatalogItem(template, this.pricing));
  }

  /**
   * Throws unless the gift can be bought right now — the same rule as
   * the catalogue, re-checked at order creation because a vendor can
   * mark it sold out between a sender opening /send and paying.
   * CreateOrderService should never have to check this itself.
   */
  async findAvailableById(id: string): Promise<GiftTemplateRow> {
    const template = await this.repository.findById(id);

    const sellable =
      template?.available === true &&
      (!needsVendor(template) ||
        (await this.repository.findTemplateIdsWithAvailableVendor()).has(
          template.id,
        ));

    if (!template || !sellable) {
      // One message for all three causes (unknown, pulled from sale, no
      // vendor today): to a sender they are the same thing.
      throw new NotFoundException(
        "This gift isn't available right now. Please choose another.",
      );
    }

    return template;
  }

  /**
   * A gift a vendor has asked to sell, created OFF sale.
   *
   * The one write on this otherwise read-only service, kept narrow on
   * purpose: always a collection voucher (the only vendor type that is
   * fulfilled today), never on sale, never featured. Ops reviews it —
   * name, photo, price against the counter — and puts it on sale from
   * /ops/gifts. The caller (VendorsService) records the audit event,
   * because it knows which vendor asked.
   */
  async createRequestedByVendor(input: {
    name: string;
    description: string | null;
    inStorePrice: number;
    category: GiftTemplateRow['category'];
  }): Promise<GiftTemplateRow> {
    return this.repository.create({
      name: input.name,
      description: input.description,
      base_price: input.inStorePrice,
      category: input.category,
      delivery_type: FulfillmentType.DigitalVoucher,
      requires_address: false,
      available: false,
      featured: false,
    });
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
