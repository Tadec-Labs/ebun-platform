import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { GiftsService } from '../gifts/gifts.service';
import { OrdersService } from '../orders/orders.service';
import { PublicPhotosService } from '../storage/public-photos.service';
import type { UploadedPhoto } from '../storage/public-photos.service';
import { RequestVendorItemDto, UpdateVendorProfileDto } from './dto/vendor.dto';
import type { VendorContext } from './vendor-portal.guard';
import {
  PortalOfferingRow,
  VendorRow,
  VendorsRepository,
} from './vendors.repository';
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

export interface PickupView {
  orderId: string;
  giftName: string;
  recipientFirstName: string;
  pickupAt: string;
  /** The vendor already tapped "Got it". */
  confirmed: boolean;
  /**
   * kobo — already paid by the sender and owed to the vendor on handover.
   * Shown so the counter sees the money is real before preparing anything.
   */
  youReceive: number | null;
}

/** A booking stays on the vendor's list this long after its time. */
const LATE_ARRIVAL_WINDOW_MS = 2 * 60 * 60_000;

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
    private readonly orders: OrdersService,
    private readonly photos: PublicPhotosService,
  ) {}

  /**
   * Who is coming, for what, and when — the counter's "Coming in" list.
   *
   * Shows a booking up to two hours after its time (people run late),
   * soonest first. First name only: enough to call out at the counter.
   * Never the collection code — the code is the recipient's to show;
   * a vendor holding it could mark a gift collected that nobody
   * collected.
   */
  async listPickups(vendorId: string): Promise<PickupView[]> {
    const [rows, offerings] = await Promise.all([
      this.orders.findUpcomingPickups(
        vendorId,
        new Date(Date.now() - LATE_ARRIVAL_WINDOW_MS),
      ),
      this.vendors.listPortalOfferings(vendorId),
    ]);
    const priceOf = new Map(
      offerings.map((o) => [o.gift_template_id, o.vendor_price]),
    );
    return rows.map((row) => ({
      youReceive: priceOf.get(row.gift_template_id) ?? null,
      orderId: row.id,
      giftName: row.gift_templates?.name ?? 'Gift',
      recipientFirstName:
        row.recipient_name.trim().split(/\s+/)[0] || row.recipient_name,
      pickupAt: row.pickup_at,
      confirmed: row.pickup_confirmed_at !== null,
    }));
  }

  /** "Got it, it'll be ready" — shown to the recipient on their gift page. */
  async confirmPickup(
    vendor: VendorContext,
    orderId: string,
    meta: RequestMeta,
  ): Promise<{ confirmed: true }> {
    const row = await this.orders.confirmPickup(orderId, vendor.vendorId);
    if (!row) {
      throw new NotFoundException('No booking like that for your shop.');
    }

    await this.audit.record({
      eventType: 'order.pickup_confirmed',
      actorId: null,
      actorType: 'vendor',
      resourceType: 'order',
      resourceId: orderId,
      metadata: { vendorId: vendor.vendorId, pickupAt: row.pickup_at },
      ...meta,
    });

    return { confirmed: true };
  }

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
    photo?: UploadedPhoto,
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

    // Photo first: if it's rejected (wrong type, too big), nothing has
    // been created yet and the vendor just picks another picture.
    const imageUrl = photo ? await this.photos.upload(photo, 'gifts') : null;

    let template: Awaited<ReturnType<GiftsService['createRequestedByVendor']>>;
    try {
      template = await this.gifts.createRequestedByVendor({
        name: dto.name,
        description: dto.description ?? null,
        inStorePrice: dto.inStorePrice,
        category: record.category,
        imageUrl,
        bookingStyle: dto.bookingStyle,
      });

      await this.vendors.upsertOffering({
        vendor_id: vendor.vendorId,
        gift_template_id: template.id,
        vendor_price: vendorPrice,
        available_zones: null,
        available: true,
        approved: false,
      });
    } catch (err) {
      // Don't leave an orphaned photo in the bucket.
      await this.photos.deleteIfOurs(imageUrl);
      throw err;
    }

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
        withPhoto: imageUrl !== null,
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

  /**
   * A photo for one of the vendor's own items. Allowed while the item is
   * waiting for approval, or when it has no photo at all. Once an item is
   * live with a photo, senders have seen that picture — changing it goes
   * through SendEbun, like a price change.
   */
  async addPhoto(
    vendor: VendorContext,
    giftTemplateId: string,
    photo: UploadedPhoto,
    meta: RequestMeta,
  ): Promise<PortalOfferingView> {
    const row = (await this.vendors.listPortalOfferings(vendor.vendorId)).find(
      (offering) => offering.gift_template_id === giftTemplateId,
    );
    if (!row) {
      throw new NotFoundException("You don't sell that gift on SendEbun.");
    }
    if (row.approved && row.gift_templates?.image_url) {
      throw new BadRequestException(
        'This item is live with a photo. To change it, send the new photo to SendEbun on WhatsApp.',
      );
    }

    const imageUrl = await this.photos.upload(photo, 'gifts');
    const previous = await this.gifts.setImageUrl(giftTemplateId, imageUrl);
    await this.photos.deleteIfOurs(previous);

    await this.audit.record({
      eventType: 'vendor_offering.photo_added',
      actorId: null,
      actorType: 'vendor',
      resourceType: 'vendor',
      resourceId: vendor.vendorId,
      metadata: { giftTemplateId, via: 'vendor_portal' },
      ...meta,
    });

    return toPortalView({
      ...row,
      gift_templates: row.gift_templates
        ? { ...row.gift_templates, image_url: imageUrl }
        : null,
    });
  }

  /**
   * What the vendor sees of their own profile. Bank details come back
   * masked: the counter phone needs to show THAT they're set, never the
   * number itself.
   */
  async getProfile(vendorId: string): Promise<VendorProfileView> {
    const row = await this.vendors.findById(vendorId);
    if (!row) throw new NotFoundException('Vendor not found.');
    return toProfileView(row);
  }

  async updateProfile(
    vendor: VendorContext,
    dto: UpdateVendorProfileDto,
    meta: RequestMeta,
  ): Promise<VendorProfileView> {
    const row = await this.vendors.findById(vendor.vendorId);
    if (!row) throw new NotFoundException('Vendor not found.');

    const values: Record<string, unknown> = {};
    if (dto.ownerName !== undefined) values.owner_name = dto.ownerName;
    if (dto.pickupAddress !== undefined)
      values.pickup_address = dto.pickupAddress;
    if (dto.pickupHours !== undefined) values.pickup_hours = dto.pickupHours;

    const bankFields = [dto.bankName, dto.accountNumber, dto.accountName];
    const sendsBank = bankFields.some((value) => value !== undefined);
    if (sendsBank) {
      if (row.account_number) {
        throw new BadRequestException(
          'Your bank details are already set. To change them, contact SendEbun.',
        );
      }
      if (bankFields.some((value) => value === undefined)) {
        throw new BadRequestException(
          'Enter your bank name, 10-digit account number and account name together.',
        );
      }
      values.bank_name = dto.bankName;
      values.account_number = dto.accountNumber;
      values.account_name = dto.accountName;
    }

    if (Object.keys(values).length === 0) return toProfileView(row);

    const updated = await this.vendors.update(vendor.vendorId, values);
    if (!updated) throw new NotFoundException('Vendor not found.');

    await this.audit.record({
      eventType: 'vendor.profile_updated',
      actorId: null,
      actorType: 'vendor',
      resourceType: 'vendor',
      resourceId: vendor.vendorId,
      // Field names only. Bank details never enter the audit log.
      metadata: {
        changedFields: Object.keys(values).sort(),
        via: 'vendor_portal',
      },
      ...meta,
    });

    return toProfileView(updated);
  }
}

export interface VendorProfileView {
  businessName: string;
  ownerName: string;
  pickupAddress: string | null;
  pickupHours: string | null;
  bank: {
    bankName: string | null;
    accountName: string | null;
    accountLast4: string;
  } | null;
  /** What still stops recipients being sent here, in the vendor's words. Empty = ready. */
  missing: string[];
}

function toProfileView(row: VendorRow): VendorProfileView {
  const missing: string[] = [];
  if (!row.pickup_address?.trim()) missing.push('pickup address');
  if (!row.account_number) missing.push('bank details');
  return {
    businessName: row.business_name,
    ownerName: row.owner_name,
    pickupAddress: row.pickup_address,
    pickupHours: row.pickup_hours,
    bank: row.account_number
      ? {
          bankName: row.bank_name,
          accountName: row.account_name,
          accountLast4: row.account_number.slice(-4),
        }
      : null,
    missing,
  };
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
