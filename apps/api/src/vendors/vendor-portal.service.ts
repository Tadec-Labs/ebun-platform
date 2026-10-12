import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { GiftsService } from '../gifts/gifts.service';
import { RequestVendorItemDto } from './dto/vendor.dto';
import type { VendorContext } from './vendor-portal.guard';
import { PortalOfferingRow, VendorsRepository } from './vendors.repository';
import type { RequestMeta } from './vendors.service';

/**
 * Where an item stands, in the vendor's words:
 * - `live`: approved and on sale — senders can buy it
 * - `awaiting_approval`: the vendor asked for it; SendEbun hasn't checked it yet
 * - `not_on_sale`: approved, but SendEbun has it off the catalogue
 *   (e.g. waiting for a photo) — senders can't buy it
 */
export type PortalOfferingStatus = 'live' | 'awaiting_approval' | 'not_on_sale';

export interface PortalOfferingView {
  giftTemplateId: string;
  name: string;
  imageUrl: string | null;
  /** kobo — what the customer pays the vendor in store, and what SendEbun charges for the gift. */
  inStorePrice: number;
  /** kobo — what SendEbun pays the vendor per collection. */
  youReceive: number;
  /** The vendor's own switch: false = sold out today. */
  available: boolean;
  status: PortalOfferingStatus;
}

/**
 * A vendor can't have more than this many requests waiting. A cap, not a
 * rate: it bounds what a lost or misused counter link can add to the ops
 * queue, without getting in the way of a real vendor listing a menu.
 */
export const MAX_AWAITING_APPROVAL = 10;

/**
 * Everything a vendor can do to their own listing from the counter link.
 *
 * Deliberately small. A vendor can say what they have today, and ask to
 * sell something new. They cannot change a price, approve anything, or
 * put anything on sale: prices are what senders are promised, so every
 * change goes past ops first. Separate from VendorsService, which is the
 * staff surface, so the line between the two stays visible.
 */
@Injectable()
export class VendorPortalService {
  constructor(
    private readonly vendors: VendorsRepository,
    private readonly gifts: GiftsService,
    private readonly audit: AuditService,
  ) {}

  async listOfferings(vendorId: string): Promise<PortalOfferingView[]> {
    const rows = await this.vendors.listPortalOfferings(vendorId);
    return rows
      .map(toPortalView)
      .sort(
        (a, b) =>
          STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
          a.name.localeCompare(b.name),
      );
  }

  /**
   * Sold out today, or back on.
   *
   * Takes the gift off /send straight away when no other vendor has it
   * (GiftsService.listAvailable). Gifts already bought are NOT affected:
   * the counter still accepts their codes — see
   * VendorPortalController.sellsGift.
   */
  async setAvailability(
    vendor: VendorContext,
    giftTemplateId: string,
    available: boolean,
    meta: RequestMeta,
  ): Promise<PortalOfferingView> {
    const row = await this.vendors.setOfferingAvailability(
      vendor.vendorId,
      giftTemplateId,
      available,
    );
    if (!row) {
      throw new NotFoundException("You don't sell that gift on SendEbun.");
    }

    await this.audit.record({
      eventType: 'vendor_offering.availability_changed',
      actorId: null,
      actorType: 'vendor',
      resourceType: 'vendor',
      resourceId: vendor.vendorId,
      newState: available ? 'available' : 'sold_out',
      metadata: {
        giftTemplateId,
        giftName: row.gift_templates?.name ?? null,
        via: 'vendor_portal',
      },
      ...meta,
    });

    return toPortalView(row);
  }

  /**
   * A new item the vendor wants to sell. Creates the gift off sale and
   * an unapproved offering at the vendor's agreed share of the in-store
   * price — so when ops approves, the price and the payout are already
   * filled in and only need checking.
   */
  async requestItem(
    vendor: VendorContext,
    dto: RequestVendorItemDto,
    meta: RequestMeta,
  ): Promise<PortalOfferingView> {
    const record = await this.vendors.findById(vendor.vendorId);
    if (!record) {
      // The guard just found this vendor; gone now means deleted mid-request.
      throw new NotFoundException('Vendor not found.');
    }

    const waiting = await this.vendors.countAwaitingApproval(vendor.vendorId);
    if (waiting >= MAX_AWAITING_APPROVAL) {
      throw new BadRequestException(
        `You have ${waiting} items waiting for SendEbun to check. We'll get to them before you add more.`,
      );
    }

    const vendorPrice = vendorShareOf(dto.inStorePrice, record.commission_rate);
    if (vendorPrice < 1 || vendorPrice >= dto.inStorePrice) {
      // Only reachable with a commission_rate of 1.0 or more, which
      // would mean SendEbun earns nothing — a setup problem for ops,
      // not something the vendor can fix.
      throw new BadRequestException(
        "We couldn't price this item. Please ask SendEbun to check your account.",
      );
    }

    const template = await this.gifts.createRequestedByVendor({
      name: dto.name,
      description: dto.description ?? null,
      inStorePrice: dto.inStorePrice,
      category: record.category,
    });

    await this.vendors.upsertOffering({
      vendor_id: vendor.vendorId,
      gift_template_id: template.id,
      vendor_price: vendorPrice,
      available_zones: null,
      available: true,
      approved: false,
    });

    await this.audit.record({
      eventType: 'vendor_offering.requested',
      actorId: null,
      actorType: 'vendor',
      resourceType: 'vendor',
      resourceId: vendor.vendorId,
      newState: 'awaiting_approval',
      metadata: {
        giftTemplateId: template.id,
        giftName: template.name,
        inStorePrice: dto.inStorePrice,
        vendorPrice,
        via: 'vendor_portal',
      },
      ...meta,
    });

    return {
      giftTemplateId: template.id,
      name: template.name,
      imageUrl: template.image_url,
      inStorePrice: template.base_price,
      youReceive: vendorPrice,
      available: true,
      status: 'awaiting_approval',
    };
  }
}

const STATUS_ORDER: Record<PortalOfferingStatus, number> = {
  live: 0,
  not_on_sale: 1,
  awaiting_approval: 2,
};

/**
 * The vendor's share, rounded DOWN to a whole naira: a payout never
 * shows kobo, and rounding never pays out more than the agreed share.
 */
export function vendorShareOf(inStorePrice: number, share: number): number {
  // Rounded to whole kobo first, so float noise (0.9 isn't exact in
  // binary) can't knock a naira off.
  return Math.floor(Math.round(inStorePrice * share) / 100) * 100;
}

function toPortalView(row: PortalOfferingRow): PortalOfferingView {
  const gift = row.gift_templates;
  const status: PortalOfferingStatus = !row.approved
    ? 'awaiting_approval'
    : gift?.available
      ? 'live'
      : 'not_on_sale';
  return {
    giftTemplateId: row.gift_template_id,
    name: gift?.name ?? 'Unknown gift',
    imageUrl: gift?.image_url ?? null,
    inStorePrice: gift?.base_price ?? 0,
    youReceive: row.vendor_price,
    available: row.available,
    status,
  };
}
