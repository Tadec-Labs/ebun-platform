import { Injectable, NotFoundException } from '@nestjs/common';
import { FulfillmentType } from '@ebun/types';
import { PricingService } from '../pricing/pricing.service';
import {
  GiftTemplateRow,
  GiftTemplatesRepository,
  SellableOfferingRow,
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
  /** kobo — doorstep gifts only, shown as its own line. Goes to the vendor who delivers. */
  deliveryFee: number;
  /** kobo — exactly what Paystack will charge. */
  totalPrice: number;
  deliveryType: GiftTemplateRow['delivery_type'];
  deliveryWindow: string | null;
  requiresAddress: boolean;
  featured: boolean;
  occasions: string[];
  bookingStyle: GiftTemplateRow['booking_style'];
  /**
   * True for gifts no shop hands over (airtime, data, power): they reach
   * a recipient anywhere in Nigeria. `cities` is empty for these.
   */
  nationwide: boolean;
  /**
   * Where a shop can hand this gift over today, and who. A sender only
   * sees a shop-fulfilled gift once they've said the recipient is in one
   * of these cities. Seller names are public (they're on the reveal
   * screen anyway); nothing about a seller's price or contact is here.
   */
  cities: GiftCityAvailability[];
}

export interface GiftCityAvailability {
  city: string;
  /** Shop names, A–Z, de-duplicated. */
  sellers: string[];
  /** Doorstep gifts: areas shops in this city deliver to. Empty = not listed. */
  deliveryAreas: string[];
}

function toCatalogItem(
  template: GiftTemplateRow,
  pricing: PricingService,
  cities: GiftCityAvailability[],
): GiftCatalogItem {
  const price = pricing.priceGift(template.base_price, template.delivery_type);
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    category: template.category,
    imageUrl: template.image_url,
    basePrice: template.base_price,
    serviceFee: price.serviceFee,
    deliveryFee: price.deliveryFee,
    totalPrice: price.total,
    deliveryType: template.delivery_type,
    deliveryWindow: template.delivery_window,
    requiresAddress: template.requires_address,
    featured: template.featured,
    occasions: template.occasions ?? [],
    bookingStyle: template.booking_style ?? 'pickup',
    nationwide: !needsVendor(template),
    cities: needsVendor(template) ? cities : [],
  };
}

/**
 * Groups sellable offerings by gift, then by city. A shop with no city
 * yet is left out entirely: until ops says where it is, it can't be
 * promised to anyone's recipient.
 */
function availabilityByGift(
  offerings: SellableOfferingRow[],
): Map<string, GiftCityAvailability[]> {
  type CityEntry = { sellers: Set<string>; areas: Map<string, string> };
  const byGift = new Map<string, Map<string, CityEntry>>();
  for (const { gift_template_id: giftId, vendors: shop } of offerings) {
    if (!shop?.active || !shop.city_slug) continue;
    let cities = byGift.get(giftId);
    if (!cities) {
      cities = new Map<string, CityEntry>();
      byGift.set(giftId, cities);
    }
    let entry = cities.get(shop.city_slug);
    if (!entry) {
      entry = { sellers: new Set<string>(), areas: new Map<string, string>() };
      cities.set(shop.city_slug, entry);
    }
    entry.sellers.add(shop.business_name.trim());
    for (const raw of shop.service_areas ?? []) {
      const label = raw.replace(/\s+/g, ' ').trim();
      const key = label.toLowerCase();
      if (key && !entry.areas.has(key)) entry.areas.set(key, label);
    }
  }

  const result = new Map<string, GiftCityAvailability[]>();
  for (const [giftId, cities] of byGift) {
    result.set(
      giftId,
      [...cities.entries()]
        .map(([city, entry]) => ({
          city,
          sellers: [...entry.sellers].sort((a, b) => a.localeCompare(b)),
          deliveryAreas: [...entry.areas.values()].sort((a, b) =>
            a.localeCompare(b),
          ),
        }))
        .sort((a, b) => a.city.localeCompare(b.city)),
    );
  }
  return result;
}

/**
 * Airtime, data and power go straight from the VTU provider to the
 * recipient — no counter, no vendor. Everything else is handed over by
 * a vendor and needs one.
 */
function needsVendor(template: GiftTemplateRow): boolean {
  return template.delivery_type !== FulfillmentType.Vtu;
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
   *
   * With a city, "a vendor" means a shop in that city: only what can
   * actually reach the recipient is listed, plus the nationwide gifts.
   * Without one, every city's gifts are listed, each carrying the cities
   * it can be sent to, so the sender's screen can filter instantly.
   */
  async listAvailable(city?: string): Promise<GiftCatalogItem[]> {
    const [templates, offerings] = await Promise.all([
      this.repository.findAllAvailable(),
      this.repository.findSellableOfferings(),
    ]);
    const availability = availabilityByGift(offerings);
    const items: GiftCatalogItem[] = [];
    for (const template of templates) {
      let cities = availability.get(template.id) ?? [];
      if (city) cities = cities.filter((c) => c.city === city);
      if (needsVendor(template) && cities.length === 0) continue;
      items.push(toCatalogItem(template, this.pricing, cities));
    }
    return items;
  }

  /**
   * Throws unless the gift can be bought right now — the same rule as
   * the catalogue, re-checked at order creation because a vendor can
   * mark it sold out between a sender opening /send and paying.
   * CreateOrderService should never have to check this itself.
   *
   * With a city, a shop-fulfilled gift also needs a shop in that city:
   * this is the check that stops an Akure-only gift being paid for on
   * behalf of someone in Lagos.
   */
  async findAvailableById(id: string, city?: string): Promise<GiftTemplateRow> {
    const template = await this.repository.findById(id);

    let sellable = template?.available === true;
    if (template && sellable && needsVendor(template)) {
      if (city) {
        const cities =
          availabilityByGift(
            await this.repository.findSellableOfferings(template.id),
          ).get(template.id) ?? [];
        sellable = cities.some((c) => c.city === city);
      } else {
        sellable = (
          await this.repository.findTemplateIdsWithAvailableVendor()
        ).has(template.id);
      }
    }

    if (!template || !sellable) {
      // One message for every cause (unknown, pulled from sale, no
      // vendor today, none in their city): to a sender they are the
      // same thing.
      throw new NotFoundException(
        city
          ? "This gift isn't available where they are right now. Please choose another."
          : "This gift isn't available right now. Please choose another.",
      );
    }

    return template;
  }

  /**
   * Doorstep gifts: the areas shops in this city deliver this gift to.
   * Empty when none are listed (any address in the city is then taken).
   */
  async deliveryAreasIn(
    giftTemplateId: string,
    city: string,
  ): Promise<string[]> {
    const cities =
      availabilityByGift(
        await this.repository.findSellableOfferings(giftTemplateId),
      ).get(giftTemplateId) ?? [];
    return cities.find((c) => c.city === city)?.deliveryAreas ?? [];
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
    imageUrl?: string | null;
    bookingStyle?: GiftTemplateRow['booking_style'];
  }): Promise<GiftTemplateRow> {
    return this.repository.create({
      name: input.name,
      description: input.description,
      image_url: input.imageUrl ?? null,
      booking_style: input.bookingStyle ?? 'pickup',
      base_price: input.inStorePrice,
      category: input.category,
      delivery_type: FulfillmentType.DigitalVoucher,
      requires_address: false,
      available: false,
      featured: false,
    });
  }

  /**
   * Sets a gift's photo — used when a vendor adds one to an item still
   * waiting for approval. Ops replace photos through OpsGiftsService.
   * Returns the previous URL so the caller can delete the old file.
   */
  async setImageUrl(id: string, imageUrl: string): Promise<string | null> {
    const existing = await this.findById(id);
    await this.repository.update(id, { image_url: imageUrl });
    return existing.image_url;
  }

  /**
   * Puts a gift on sale — ops approving a vendor's item and publishing
   * it in one step. Returns the row as it was before, so the caller can
   * audit the change; null when the gift doesn't exist.
   */
  async putOnSale(id: string): Promise<GiftTemplateRow | null> {
    const existing = await this.repository.findById(id);
    if (!existing) return null;
    if (!existing.available) {
      await this.repository.update(id, { available: true });
    }
    return existing;
  }

  /**
   * Deletes the off-sale gift a vendor's request created, when they
   * withdraw the request. Only ever a gift nobody has bought: one with
   * orders is history and stays. Returns the deleted row (so the caller
   * can remove its photo), or null when it was kept or already gone.
   */
  async deleteVendorDraft(id: string): Promise<GiftTemplateRow | null> {
    if (await this.repository.isReferenced(id)) return null;
    return this.repository.delete(id);
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
