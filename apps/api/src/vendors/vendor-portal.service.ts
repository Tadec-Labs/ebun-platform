import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { VendorAlertsService } from '../alerts/vendor-alerts.service';
import { AuditService } from '../audit/audit.service';
import { GiftsService } from '../gifts/gifts.service';
import { OrdersService } from '../orders/orders.service';
import { vendorPayoutForOrder } from '../pricing/vendor-payout';
import { PublicPhotosService } from '../storage/public-photos.service';
import type { UploadedPhoto } from '../storage/public-photos.service';
import { RequestVendorItemDto, UpdateVendorProfileDto } from './dto/vendor.dto';
import type { VendorContext } from './vendor-portal.guard';
import {
  PortalOfferingRow,
  PriceChangeRefusedError,
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
  /** kobo — a new shop price the vendor asked for, waiting on SendEbun. Null = none. */
  proposedPrice: number | null;
  /**
   * False when another shop sells the same gift: one gift has one
   * price, so its price is SendEbun's to change, not one vendor's.
   */
  canChangePrice: boolean;
}

export interface PickupView {
  orderId: string;
  giftName: string;
  recipientFirstName: string;
  pickupAt: string;
  /** The vendor already tapped "Got it". */
  confirmed: boolean;
  /** The booked time has passed: "Didn't come" is offered. */
  canMarkNoShow: boolean;
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
    private readonly alerts: VendorAlertsService,
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
    const offeringOf = new Map(offerings.map((o) => [o.gift_template_id, o]));
    return rows.map((row) => ({
      // The same figure they'll be credited: their share of what the
      // sender paid, even if the price has changed since.
      youReceive: youReceiveFor(offeringOf.get(row.gift_template_id), row),
      orderId: row.id,
      giftName: row.gift_templates?.name ?? 'Gift',
      recipientFirstName:
        row.recipient_name.trim().split(/\s+/)[0] || row.recipient_name,
      pickupAt: row.pickup_at,
      confirmed: row.pickup_confirmed_at !== null,
      canMarkNoShow: new Date(row.pickup_at).getTime() <= Date.now(),
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

  /**
   * "Didn't come." The booking is cleared and the recipient's page asks
   * them to pick a new time — one free rebook. At the second miss ops is
   * told: the agreed rule is that the gift then counts as used and the
   * shop is still paid, which ops applies by hand after a call, because
   * it ends a gift someone paid for.
   */
  async markNoShow(
    vendor: VendorContext,
    orderId: string,
    meta: RequestMeta,
  ): Promise<{ noShows: number }> {
    const row = await this.orders.markPickupNoShow(orderId, vendor.vendorId);
    if (!row) {
      throw new NotFoundException(
        'No past booking like that for your shop. If they come later, just check their code as usual.',
      );
    }

    await this.audit.record({
      eventType: 'order.pickup_no_show',
      actorId: null,
      actorType: 'vendor',
      resourceType: 'order',
      resourceId: orderId,
      metadata: { vendorId: vendor.vendorId, noShows: row.pickup_no_shows },
      ...meta,
    });

    if (row.pickup_no_shows >= 2) {
      await this.alerts.handoverProblem({
        orderId,
        key: `no-show-2:${orderId}`,
        subject: `${row.recipient_name} missed a second booking (${row.order_number ?? orderId})`,
        lines: [
          `${vendor.businessName} marked ${row.recipient_name} as not coming, for the second time.`,
          '',
          'Agreed rule: the gift now counts as used and the shop is paid. Call the recipient first; if they still want it, they can book once more.',
        ],
      });
    }
    return { noShows: row.pickup_no_shows };
  }

  async listOfferings(vendorId: string): Promise<PortalOfferingView[]> {
    const rows = await this.vendors.listPortalOfferings(vendorId);
    const shared = await this.vendors.giftsSoldByOthers(
      vendorId,
      rows.map((row) => row.gift_template_id),
    );
    return rows
      .map((row) => toPortalView(row, shared.has(row.gift_template_id)))
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

    return this.viewOf(vendor.vendorId, row);
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

    // Never throws; email is a second channel to the /ops queue.
    await this.alerts.vendorItemRequested({
      vendorId: vendor.vendorId,
      vendorName: record.business_name,
      giftTemplateId: template.id,
      giftName: template.name,
      inStorePrice: dto.inStorePrice,
      withPhoto: imageUrl !== null,
    });

    return {
      giftTemplateId: template.id,
      name: template.name,
      imageUrl: template.image_url,
      inStorePrice: template.base_price,
      youReceive: vendorPrice,
      available: true,
      status: 'awaiting_approval',
      proposedPrice: null,
      canChangePrice: true,
    };
  }

  /**
   * A new shop price for one of the vendor's items.
   *
   * For an item SendEbun has already approved, this is a REQUEST: it is
   * held on the offering, senders keep paying the current price, and ops
   * approves or declines it. The price is what senders are promised and
   * what they check against the counter, so it never changes on one
   * person's say-so.
   *
   * For an item still waiting for approval, nothing is selling at it
   * yet, so the vendor just corrects it — ops checks it when they
   * approve the item anyway.
   *
   * Sending the current price withdraws a pending request.
   */
  async requestPriceChange(
    vendor: VendorContext,
    giftTemplateId: string,
    inStorePrice: number,
    meta: RequestMeta,
  ): Promise<PortalOfferingView> {
    const row = await this.ownOffering(vendor.vendorId, giftTemplateId);
    const giftName = row.gift_templates?.name ?? null;
    const currentPrice = row.gift_templates?.base_price ?? 0;

    const shared = await this.vendors.giftsSoldByOthers(vendor.vendorId, [
      giftTemplateId,
    ]);
    if (shared.size > 0) {
      throw new BadRequestException(
        'Other shops sell this gift at the same price, so SendEbun changes it for everyone. Message us on WhatsApp.',
      );
    }

    if (inStorePrice === currentPrice) {
      if (row.proposed_price === null) {
        throw new BadRequestException("That's already the price.");
      }
      const withdrawn = await this.vendors.setProposedPrice(
        vendor.vendorId,
        giftTemplateId,
        null,
      );
      if (!withdrawn) throw new NotFoundException(NOT_YOURS);
      await this.audit.record({
        eventType: 'vendor_offering.price_change_withdrawn',
        actorId: null,
        actorType: 'vendor',
        resourceType: 'vendor',
        resourceId: vendor.vendorId,
        metadata: {
          giftTemplateId,
          giftName,
          withdrawnPrice: row.proposed_price,
          via: 'vendor_portal',
        },
        ...meta,
      });
      return toPortalView(withdrawn, false);
    }

    if (inStorePrice === row.proposed_price) {
      return toPortalView(row, false); // asked for this already
    }

    const record = await this.vendors.findById(vendor.vendorId);
    if (!record) throw new NotFoundException('Vendor not found.');
    const vendorPrice = vendorShareOf(inStorePrice, record.commission_rate);
    if (vendorPrice < 1 || vendorPrice >= inStorePrice) {
      throw new BadRequestException(
        "We couldn't price this item. Please ask SendEbun to check your account.",
      );
    }

    const proposed = await this.vendors.setProposedPrice(
      vendor.vendorId,
      giftTemplateId,
      inStorePrice,
    );
    if (!proposed) throw new NotFoundException(NOT_YOURS);

    if (!row.approved) {
      // Not selling yet: apply it now, through the same atomic path ops
      // uses, so the gift's price and the vendor's share move together.
      try {
        await this.vendors.approvePriceChange({
          vendorId: vendor.vendorId,
          giftTemplateId,
          expectedPrice: inStorePrice,
          vendorPrice,
        });
      } catch (err) {
        if (err instanceof PriceChangeRefusedError) {
          throw new ConflictException(
            "We couldn't change that price just now. Please try again.",
          );
        }
        throw err;
      }
      await this.audit.record({
        eventType: 'vendor_offering.price_changed',
        actorId: null,
        actorType: 'vendor',
        resourceType: 'vendor',
        resourceId: vendor.vendorId,
        metadata: {
          giftTemplateId,
          giftName,
          inStorePriceFrom: currentPrice,
          inStorePriceTo: inStorePrice,
          vendorPrice,
          stillAwaitingApproval: true,
          via: 'vendor_portal',
        },
        ...meta,
      });
      return this.viewOf(
        vendor.vendorId,
        await this.ownOffering(vendor.vendorId, giftTemplateId),
      );
    }

    await this.audit.record({
      eventType: 'vendor_offering.price_change_requested',
      actorId: null,
      actorType: 'vendor',
      resourceType: 'vendor',
      resourceId: vendor.vendorId,
      newState: 'price_change_pending',
      metadata: {
        giftTemplateId,
        giftName,
        inStorePriceNow: currentPrice,
        inStorePriceAsked: inStorePrice,
        via: 'vendor_portal',
      },
      ...meta,
    });

    await this.alerts.vendorPriceChangeRequested({
      vendorId: vendor.vendorId,
      vendorName: record.business_name,
      giftTemplateId,
      giftName: giftName ?? 'an item',
      currentPrice,
      proposedPrice: inStorePrice,
      proposedAt: proposed.price_proposed_at ?? new Date().toISOString(),
    });

    return toPortalView(proposed, false);
  }

  /**
   * The vendor stops selling an item.
   *
   * Refused while a paid gift still needs this vendor: its code would be
   * turned away at the counter (sellsGift reads the offering) and the
   * payout lookup would find nothing — a recipient holding a gift
   * SendEbun took money for, and nowhere to collect it. "Sold out"
   * already stops new sales; that is what to use until those are done.
   *
   * An item SendEbun never approved also takes its draft gift with it
   * (if nobody else sells it and nobody bought it): it existed only as
   * this vendor's request, and leaving it would clutter the ops
   * catalogue and keep its name taken. An approved item's gift stays —
   * whether it lives on with another partner is ops' call.
   *
   * Residual gap, accepted: a sender already at the Paystack page when
   * the item is removed can still complete payment. Same as "sold out";
   * ops sees that order with no partner.
   */
  async removeItem(
    vendor: VendorContext,
    giftTemplateId: string,
    meta: RequestMeta,
  ): Promise<{ removed: true }> {
    const row = await this.ownOffering(vendor.vendorId, giftTemplateId);

    const relying = await this.vendors.ordersStillRelyingOn(
      vendor.vendorId,
      giftTemplateId,
    );
    if (relying > 0) {
      throw new ConflictException(
        `${relying} paid ${relying === 1 ? 'gift is' : 'gifts are'} still waiting to be collected or delivered here. Switch this item to Sold out for now — you can remove it once ${relying === 1 ? "it's" : "they're"} done.`,
      );
    }

    const shared = await this.vendors.giftsSoldByOthers(vendor.vendorId, [
      giftTemplateId,
    ]);

    const removed = await this.vendors.deleteOffering(
      vendor.vendorId,
      giftTemplateId,
    );
    if (!removed) throw new NotFoundException(NOT_YOURS);

    let draftDeleted = false;
    if (!row.approved && shared.size === 0 && !row.gift_templates?.available) {
      const draft = await this.gifts.deleteVendorDraft(giftTemplateId);
      if (draft) {
        draftDeleted = true;
        await this.photos.deleteIfOurs(draft.image_url);
      }
    }

    await this.audit.record({
      eventType: 'vendor_offering.removed',
      actorId: null,
      actorType: 'vendor',
      resourceType: 'vendor',
      resourceId: vendor.vendorId,
      metadata: {
        giftTemplateId,
        giftName: row.gift_templates?.name ?? null,
        wasApproved: row.approved,
        draftDeleted,
        via: 'vendor_portal',
      },
      ...meta,
    });

    return { removed: true };
  }

  /** The vendor's own offering for this gift, or the same 404 as a gift they don't sell. */
  private async ownOffering(
    vendorId: string,
    giftTemplateId: string,
  ): Promise<PortalOfferingRow> {
    const row = (await this.vendors.listPortalOfferings(vendorId)).find(
      (offering) => offering.gift_template_id === giftTemplateId,
    );
    if (!row) throw new NotFoundException(NOT_YOURS);
    return row;
  }

  /** One row's view, with whether someone else sells the same gift. */
  private async viewOf(
    vendorId: string,
    row: PortalOfferingRow,
  ): Promise<PortalOfferingView> {
    const shared = await this.vendors.giftsSoldByOthers(vendorId, [
      row.gift_template_id,
    ]);
    return toPortalView(row, shared.size > 0);
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

    return this.viewOf(vendor.vendorId, {
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
    if (dto.email !== undefined) values.email = dto.email;
    if (dto.backupPhone !== undefined) values.backup_phone = dto.backupPhone;
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
      // Picked from Paystack's list: lets SendEbun pay them automatically.
      if (dto.bankCode) values.bank_code = dto.bankCode;
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
  /** Where order alerts are emailed. */
  email: string | null;
  backupPhone: string | null;
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
    email: row.email,
    backupPhone: row.backup_phone ?? null,
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

const NOT_YOURS = "You don't sell that gift on SendEbun.";

function youReceiveFor(
  offering: PortalOfferingRow | undefined,
  order: { gift_value: number },
): number | null {
  if (!offering) return null;
  return vendorPayoutForOrder({
    vendorPrice: offering.vendor_price,
    currentBasePrice: offering.gift_templates?.base_price ?? order.gift_value,
    paidGiftValue: order.gift_value,
  });
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

function toPortalView(
  row: PortalOfferingRow,
  soldByOthers: boolean,
): PortalOfferingView {
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
    proposedPrice: row.proposed_price ?? null,
    canChangePrice: !soldByOthers,
  };
}
