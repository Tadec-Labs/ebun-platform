import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { StaffContext } from '../auth/staff.guard';
import { GiftsService } from '../gifts/gifts.service';
import { AutoPayoutsService } from '../payouts/auto-payouts.service';
import {
  CreateVendorDto,
  UpdateVendorDto,
  UpsertOfferingDto,
} from './dto/vendor.dto';
import {
  OfferingRow,
  PriceChangeRefusedError,
  VendorRow,
  VendorSummaryRow,
  VendorsRepository,
} from './vendors.repository';
import { vendorShareOf } from './vendor-portal.service';

export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

export interface VendorSummaryView {
  id: string;
  businessName: string;
  ownerName: string;
  whatsappNumber: string;
  category: VendorRow['category'];
  serviceAreas: string[];
  deliveryZones: string[];
  active: boolean;
  verified: boolean;
  totalOrders: number;
  /** The partner's share (0.90 = they receive 90%) — used to suggest what to pay them for a gift. */
  commissionRate: number;
  offeringsCount: number;
  /** Items this vendor asked to sell from their counter link, waiting on ops. */
  awaitingApprovalCount: number;
  /** New prices this vendor asked for, waiting on ops. */
  priceRequestCount: number;
  createdAt: string;
}

export interface VendorView {
  id: string;
  businessName: string;
  ownerName: string;
  whatsappNumber: string;
  email: string | null;
  /** Second contact for when the WhatsApp number goes quiet. */
  backupPhone: string | null;
  category: VendorRow['category'];
  subcategories: string[];
  serviceAreas: string[];
  deliveryZones: string[];
  /** The vendor's SHARE of gift value (0.90 = vendor gets 90%, SendEbun's commission is 10%) — despite the column name. */
  commissionRate: number;
  bankName: string | null;
  /** Paystack bank code — set by picking the bank from the list. */
  bankCode: string | null;
  accountNumber: string | null;
  accountName: string | null;
  /**
   * Whether this partner is paid automatically after each handover
   * (AUTO_PAYOUTS on, bank picked from the list, account complete).
   * Otherwise they stay on the manual Payouts queue.
   */
  autoPayouts: { on: boolean; reason: string | null };
  active: boolean;
  verified: boolean;
  totalOrders: number;
  responseTimeoutMinutes: number;
  backupVendorId: string | null;
  notes: string | null;
  pickupAddress: string | null;
  pickupHours: string | null;
  /**
   * The vendor's private counter-screen link. A credential, so it
   * travels only on the single-vendor read (never the list), only to
   * ebun_admin/ebun_ops, and only on a no-store response — the same
   * treatment bank details already get.
   */
  portalToken: string;
  portalTokenRotatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Where a recipient can collect a gift — public business details only. */
export interface CollectionPointView {
  /** So the recipient can say which place they're collecting from. */
  vendorId: string;
  name: string;
  address: string;
  hours: string | null;
  /**
   * The business's WhatsApp, so the recipient can tell them they're
   * coming. A number the business gave SendEbun to be contacted on; it
   * is shown only to someone holding a claimed gift for them.
   */
  whatsapp: string;
}

export interface OfferingView {
  giftTemplateId: string;
  giftName: string;
  /** What the sender pays, kobo. */
  senderPrice: number;
  /** What Ebun pays the vendor, kobo. */
  vendorPrice: number;
  /** senderPrice - vendorPrice, kobo. */
  ebunMargin: number;
  /** ebunMargin as a percentage of senderPrice, one decimal place. */
  ebunMarginPct: number;
  availableZones: string[];
  available: boolean;
  approved: boolean;
  /** The gift is switched on sale in the catalogue. */
  giftOnSale: boolean;
  /** The gift has a photo — wanted before it goes on sale. */
  giftHasPhoto: boolean;
  /**
   * A new IN-STORE price (kobo) the vendor asked for from their link.
   * Senders keep paying senderPrice until ops approves. Null = none.
   */
  proposedPrice: number | null;
  /** kobo — what the vendor would receive at the proposed price (their agreed share). */
  proposedVendorPrice: number | null;
  priceProposedAt: string | null;
}

const FIELD_MAP: Record<string, string> = {
  businessName: 'business_name',
  ownerName: 'owner_name',
  whatsappNumber: 'whatsapp_number',
  email: 'email',
  backupPhone: 'backup_phone',
  category: 'category',
  subcategories: 'subcategories',
  serviceAreas: 'service_areas',
  deliveryZones: 'delivery_zones',
  commissionRate: 'commission_rate',
  bankName: 'bank_name',
  bankCode: 'bank_code',
  accountNumber: 'account_number',
  accountName: 'account_name',
  responseTimeoutMinutes: 'response_timeout_minutes',
  backupVendorId: 'backup_vendor_id',
  notes: 'notes',
  pickupAddress: 'pickup_address',
  pickupHours: 'pickup_hours',
  active: 'active',
  verified: 'verified',
};

/** `undefined` = not provided (skipped). `null` = explicitly clear. */
function toRowValues(dto: object): Record<string, unknown> {
  const source = dto as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [camel, snake] of Object.entries(FIELD_MAP)) {
    if (source[camel] !== undefined) {
      out[snake] = source[camel];
    }
  }
  return out;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function toSummaryView(
  row: VendorSummaryRow,
  offeringsCount: number,
  awaitingApprovalCount: number,
  priceRequestCount: number,
): VendorSummaryView {
  return {
    id: row.id,
    businessName: row.business_name,
    ownerName: row.owner_name,
    whatsappNumber: row.whatsapp_number,
    category: row.category,
    serviceAreas: row.service_areas ?? [],
    deliveryZones: row.delivery_zones ?? [],
    active: row.active,
    verified: row.verified,
    totalOrders: row.total_orders,
    commissionRate: Number(row.commission_rate),
    offeringsCount,
    awaitingApprovalCount,
    priceRequestCount,
    createdAt: row.created_at,
  };
}

function toView(row: VendorRow, autoPayoutsEnabled: boolean): VendorView {
  return {
    id: row.id,
    portalToken: row.portal_token,
    portalTokenRotatedAt: row.portal_token_rotated_at,
    businessName: row.business_name,
    ownerName: row.owner_name,
    whatsappNumber: row.whatsapp_number,
    email: row.email,
    backupPhone: row.backup_phone ?? null,
    category: row.category,
    subcategories: row.subcategories ?? [],
    serviceAreas: row.service_areas ?? [],
    deliveryZones: row.delivery_zones ?? [],
    commissionRate: row.commission_rate,
    bankName: row.bank_name,
    bankCode: row.bank_code ?? null,
    autoPayouts: autoPayoutStatus(row, autoPayoutsEnabled),
    accountNumber: row.account_number,
    accountName: row.account_name,
    active: row.active,
    verified: row.verified,
    totalOrders: row.total_orders,
    responseTimeoutMinutes: row.response_timeout_minutes,
    backupVendorId: row.backup_vendor_id,
    notes: row.notes,
    pickupAddress: row.pickup_address,
    pickupHours: row.pickup_hours,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toOfferingView(row: OfferingRow, vendorShare: number): OfferingView {
  const senderPrice = row.gift_templates?.base_price ?? 0;
  const ebunMargin = senderPrice - row.vendor_price;
  const proposedPrice = row.proposed_price ?? null;
  return {
    giftTemplateId: row.gift_template_id,
    giftName: row.gift_templates?.name ?? 'Unknown gift',
    senderPrice,
    vendorPrice: row.vendor_price,
    ebunMargin,
    ebunMarginPct:
      senderPrice > 0 ? Math.round((ebunMargin / senderPrice) * 1000) / 10 : 0,
    availableZones: row.available_zones ?? [],
    available: row.available,
    approved: row.approved,
    giftOnSale: row.gift_templates?.available ?? false,
    giftHasPhoto: Boolean(row.gift_templates?.image_url),
    proposedPrice,
    proposedVendorPrice:
      proposedPrice === null ? null : vendorShareOf(proposedPrice, vendorShare),
    priceProposedAt: row.price_proposed_at ?? null,
  };
}

const PRICE_CHANGE_REFUSAL: Record<
  PriceChangeRefusedError['reason'],
  () => Error
> = {
  not_found: () =>
    new NotFoundException(
      'There is no price request for that gift any more. Reload the page.',
    ),
  stale: () =>
    new ConflictException(
      'The partner has asked for a different price since you loaded this page. Reload and check the new one.',
    ),
  shared_gift: () =>
    new ConflictException(
      'Other partners sell this gift too, so its price applies to all of them. Change it on the gift page instead, and decline this request.',
    ),
  invalid_share: () =>
    new BadRequestException(
      "This partner's share can't be worked out at that price. Check their share on the Details form.",
    ),
};

function autoPayoutStatus(
  row: VendorRow,
  enabled: boolean,
): VendorView['autoPayouts'] {
  if (!enabled) {
    return {
      on: false,
      reason: 'Automatic payouts are switched off (AUTO_PAYOUTS).',
    };
  }
  if (!row.account_number || !row.account_name) {
    return { on: false, reason: 'No bank details yet.' };
  }
  if (!row.bank_code) {
    return {
      on: false,
      reason: 'Pick their bank from the list to pay them automatically.',
    };
  }
  return { on: true, reason: null };
}

const formatNaira = (kobo: number) =>
  `₦${(kobo / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;

/**
 * Ops-side vendor onboarding. Nothing in the order pipeline READS
 * service_areas / delivery_zones / available_zones yet — there's no
 * automatic vendor assignment code at all today — so these are data
 * waiting for that logic, not routing rules. They're captured now so
 * onboarding doesn't have to be redone when assignment lands.
 *
 * Bank details live on the single-vendor read only (never the list) and
 * are never written to the audit log — only which FIELDS changed.
 */
@Injectable()
export class VendorsService {
  constructor(
    private readonly repository: VendorsRepository,
    private readonly gifts: GiftsService,
    private readonly audit: AuditService,
    private readonly autoPayouts: AutoPayoutsService,
  ) {}

  async list(): Promise<VendorSummaryView[]> {
    const [vendors, counts, awaiting, priceRequests] = await Promise.all([
      this.repository.list(),
      this.repository.countOfferingsByVendor(),
      this.repository.countAwaitingApprovalByVendor(),
      this.repository.countPriceRequestsByVendor(),
    ]);
    return vendors.map((v) =>
      toSummaryView(
        v,
        counts[v.id] ?? 0,
        awaiting[v.id] ?? 0,
        priceRequests[v.id] ?? 0,
      ),
    );
  }

  async get(id: string): Promise<VendorView> {
    return toView(await this.requireVendor(id), this.autoPayouts.enabled());
  }

  async create(
    dto: CreateVendorDto,
    staff: StaffContext,
    meta: RequestMeta,
  ): Promise<VendorView> {
    if (dto.backupVendorId) {
      await this.requireBackupVendor(dto.backupVendorId);
    }

    const row = await this.repository.create(toRowValues(dto));

    await this.audit.record({
      eventType: 'vendor.created',
      actorId: staff.userId,
      actorType: 'admin',
      resourceType: 'vendor',
      resourceId: row.id,
      metadata: { businessName: row.business_name, category: row.category },
      ...meta,
    });

    return toView(row, this.autoPayouts.enabled());
  }

  /**
   * Issues a new counter link and invalidates the old one.
   *
   * The answer to a lost or stolen counter phone. Audited because
   * revoking access is exactly the kind of act somebody needs to be
   * able to prove happened, and when.
   */
  async rotatePortalToken(
    id: string,
    staff: StaffContext,
    meta: RequestMeta,
  ): Promise<{ portalToken: string }> {
    const token = await this.repository.rotatePortalToken(id);
    if (!token) {
      throw new NotFoundException('Vendor not found.');
    }

    await this.audit.record({
      eventType: 'VENDOR_PORTAL_TOKEN_ROTATED',
      actorId: staff.userId,
      actorType: 'admin',
      resourceType: 'vendor',
      resourceId: id,
      // Never the token itself — an audit log that records credentials
      // is a credential store.
      metadata: { rotatedBy: staff.role },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { portalToken: token };
  }

  async update(
    id: string,
    dto: UpdateVendorDto,
    staff: StaffContext,
    meta: RequestMeta,
  ): Promise<VendorView> {
    const existing = await this.requireVendor(id);

    if (dto.backupVendorId === id) {
      throw new BadRequestException('A vendor cannot be its own backup.');
    }
    if (dto.backupVendorId) {
      await this.requireBackupVendor(dto.backupVendorId);
    }

    const values = toRowValues(dto);
    if (Object.keys(values).length === 0) {
      throw new BadRequestException('No changes provided.');
    }

    const current = existing as unknown as Record<string, unknown>;
    const changedColumns = Object.keys(values).filter(
      (column) => !sameValue(current[column], values[column]),
    );
    if (changedColumns.length === 0) {
      return toView(existing, this.autoPayouts.enabled()); // nothing actually changed — no write, no audit noise
    }

    const patch: Record<string, unknown> = {};
    for (const column of changedColumns) patch[column] = values[column];
    // New bank details need a new Paystack recipient: the old one would
    // pay the old account.
    if (
      changedColumns.some((column) =>
        ['bank_name', 'bank_code', 'account_number', 'account_name'].includes(
          column,
        ),
      )
    ) {
      patch.paystack_recipient_code = null;
    }

    const updated = await this.repository.update(id, patch);
    if (!updated) {
      throw new NotFoundException('Vendor not found');
    }

    const metadata: Record<string, unknown> = {
      changedFields: changedColumns,
    };
    // Booleans only — safe to record values, and activation/verification
    // are the changes someone investigating a dispute will look for.
    for (const flag of ['active', 'verified'] as const) {
      if (changedColumns.includes(flag)) {
        metadata[flag] = { from: current[flag], to: values[flag] };
      }
    }

    await this.audit.record({
      eventType: 'vendor.updated',
      actorId: staff.userId,
      actorType: 'admin',
      resourceType: 'vendor',
      resourceId: id,
      metadata,
      ...meta,
    });

    return toView(updated, this.autoPayouts.enabled());
  }

  /**
   * The business name only — for showing a recipient where their gift
   * was collected. Null if the vendor no longer exists. Deliberately
   * not get(): that returns bank details and the counter-link token.
   */
  async publicNameOf(vendorId: string): Promise<string | null> {
    const row = await this.repository.findById(vendorId);
    return row?.business_name ?? null;
  }

  /**
   * Where a recipient can take this gift's code — shown on their screen
   * once they have claimed it.
   *
   * The rule mirrors what the vendor counter accepts, so the screen
   * never sends someone to a counter that will turn them away: any
   * vendor with an offering row for the gift, whether or not the
   * offering is currently paused (VendorPortalController.sellsGift
   * honours paused offerings for gifts already bought). Inactive
   * vendors are left out — their counter link stops working — and so
   * are vendors with no pickup address, because a name with nowhere to
   * go is not an answer to "where do I collect this".
   */
  async collectionPointsForGift(
    giftTemplateId: string,
  ): Promise<CollectionPointView[]> {
    const rows = await this.repository.listCollectionPoints(giftTemplateId);
    const points: CollectionPointView[] = [];
    for (const { vendors: vendor } of rows) {
      const address = vendor?.pickup_address?.trim();
      if (!vendor || !vendor.active || !address) continue;
      points.push({
        vendorId: vendor.id,
        name: vendor.business_name,
        address,
        hours: vendor.pickup_hours?.trim() || null,
        whatsapp: vendor.whatsapp_number,
      });
    }
    return points.sort((a, b) => a.name.localeCompare(b.name));
  }

  async listOfferings(vendorId: string): Promise<OfferingView[]> {
    const vendor = await this.requireVendor(vendorId);
    const rows = await this.repository.listOfferings(vendorId);
    return rows.map((row) => toOfferingView(row, vendor.commission_rate));
  }

  /**
   * PUT semantics: this replaces the offering. Omitted `available` /
   * `approved` fall back to true / false rather than keeping what was
   * there — callers send the full state.
   */
  async upsertOffering(
    vendorId: string,
    giftTemplateId: string,
    dto: UpsertOfferingDto,
    staff: StaffContext,
    meta: RequestMeta,
  ): Promise<OfferingView> {
    const vendor = await this.requireVendor(vendorId);
    const gift = await this.gifts.findById(giftTemplateId); // 404s if unknown

    // Catches the classic naira-vs-kobo typo (and any price that would
    // lose money on every order) before it becomes a payout.
    if (dto.vendorPrice >= gift.base_price) {
      throw new BadRequestException(
        `Vendor price must be lower than the sender price (${formatNaira(gift.base_price)}) — otherwise Ebun earns nothing on this gift. Prices are in kobo.`,
      );
    }

    const row = await this.repository.upsertOffering({
      vendor_id: vendorId,
      gift_template_id: giftTemplateId,
      vendor_price: dto.vendorPrice,
      available_zones: dto.availableZones ?? null,
      available: dto.available ?? true,
      approved: dto.approved ?? false,
    });

    await this.audit.record({
      eventType: 'vendor_offering.upserted',
      actorId: staff.userId,
      actorType: 'admin',
      resourceType: 'vendor',
      resourceId: vendorId,
      metadata: {
        giftTemplateId,
        giftName: gift.name,
        vendorPrice: row.vendor_price,
        available: row.available,
        approved: row.approved,
      },
      ...meta,
    });

    return toOfferingView(row, vendor.commission_rate);
  }

  async removeOffering(
    vendorId: string,
    giftTemplateId: string,
    staff: StaffContext,
    meta: RequestMeta,
  ): Promise<void> {
    await this.requireVendor(vendorId);

    // Same rule as the vendor's own Remove (VendorPortalService.removeItem):
    // deleting an offering a paid gift still needs leaves that gift with
    // no counter that will accept it and no payout to record.
    const relying = await this.repository.ordersStillRelyingOn(
      vendorId,
      giftTemplateId,
    );
    if (relying > 0) {
      throw new ConflictException(
        `${relying} paid ${relying === 1 ? 'gift still needs' : 'gifts still need'} this partner to hand it over. Pause it (untick Available) instead, and remove it once ${relying === 1 ? "it's" : "they're"} collected, delivered or refunded.`,
      );
    }

    const removed = await this.repository.deleteOffering(
      vendorId,
      giftTemplateId,
    );
    if (!removed) {
      throw new NotFoundException('This vendor has no offering for that gift.');
    }

    await this.audit.record({
      eventType: 'vendor_offering.removed',
      actorId: staff.userId,
      actorType: 'admin',
      resourceType: 'vendor',
      resourceId: vendorId,
      metadata: { giftTemplateId },
      ...meta,
    });
  }

  /**
   * Approves an item the vendor asked to sell, and optionally puts its
   * gift on sale in the same step — what used to be two screens. The
   * offering keeps the price, zones and switch it already has: this is
   * a yes, not an edit.
   *
   * Two writes, approve first. If putting it on sale fails, the item is
   * approved and still off sale — a safe state that a retry finishes.
   */
  async approveOffering(
    vendorId: string,
    giftTemplateId: string,
    putOnSale: boolean,
    staff: StaffContext,
    meta: RequestMeta,
  ): Promise<OfferingView> {
    const vendor = await this.requireVendor(vendorId);
    const existing = await this.repository.findOffering(
      vendorId,
      giftTemplateId,
    );
    if (!existing) {
      throw new NotFoundException('This vendor has no offering for that gift.');
    }
    const gift = await this.gifts.findById(giftTemplateId);
    if (existing.vendor_price >= gift.base_price) {
      throw new BadRequestException(
        `This partner would be paid ${formatNaira(existing.vendor_price)} on a ${formatNaira(gift.base_price)} gift. Fix the price before approving.`,
      );
    }

    let row = existing;
    if (!existing.approved) {
      const approved = await this.repository.approveOffering(
        vendorId,
        giftTemplateId,
      );
      if (!approved) {
        throw new NotFoundException(
          'This vendor has no offering for that gift.',
        );
      }
      row = approved;
      await this.audit.record({
        eventType: 'vendor_offering.approved',
        actorId: staff.userId,
        actorType: 'admin',
        resourceType: 'vendor',
        resourceId: vendorId,
        previousState: 'awaiting_approval',
        newState: 'approved',
        metadata: {
          giftTemplateId,
          giftName: gift.name,
          vendorPrice: row.vendor_price,
          basePrice: gift.base_price,
        },
        ...meta,
      });
    }

    if (putOnSale && !gift.available) {
      const before = await this.gifts.putOnSale(giftTemplateId);
      if (before && !before.available) {
        await this.audit.record({
          eventType: 'GIFT_TEMPLATE_UPDATED',
          actorId: staff.userId,
          actorType: 'admin',
          resourceType: 'gift_template',
          resourceId: giftTemplateId,
          previousState: 'withheld',
          newState: 'available',
          metadata: {
            changedFields: ['available'],
            via: 'approve_and_put_on_sale',
            vendorId,
          },
          ...meta,
        });
      }
      const refreshed = await this.repository.findOffering(
        vendorId,
        giftTemplateId,
      );
      if (refreshed) row = refreshed;
    }

    return toOfferingView(row, vendor.commission_rate);
  }

  /**
   * Approves the vendor's new shop price: the gift's price and their
   * share change together, atomically. `expectedPrice` is the request
   * ops saw — if the vendor has asked for something else since, nothing
   * changes and ops is told to look again.
   *
   * Gifts already bought are unaffected: they were charged the old
   * price, and the payout at hand-over is the vendor's share of what the
   * sender paid (vendorPayoutForOrder).
   */
  async approvePriceChange(
    vendorId: string,
    giftTemplateId: string,
    expectedPrice: number,
    staff: StaffContext,
    meta: RequestMeta,
  ): Promise<OfferingView> {
    const vendor = await this.requireVendor(vendorId);
    const vendorPrice = vendorShareOf(expectedPrice, vendor.commission_rate);

    let result: Awaited<ReturnType<VendorsRepository['approvePriceChange']>>;
    try {
      result = await this.repository.approvePriceChange({
        vendorId,
        giftTemplateId,
        expectedPrice,
        vendorPrice,
      });
    } catch (err) {
      if (err instanceof PriceChangeRefusedError) {
        throw PRICE_CHANGE_REFUSAL[err.reason]();
      }
      throw err;
    }

    await this.audit.record({
      eventType: 'vendor_offering.price_change_approved',
      actorId: staff.userId,
      actorType: 'admin',
      resourceType: 'vendor',
      resourceId: vendorId,
      metadata: {
        giftTemplateId,
        basePriceFrom: result.old_base_price,
        basePriceTo: result.new_base_price,
        vendorPriceFrom: result.old_vendor_price,
        vendorPriceTo: result.new_vendor_price,
      },
      ...meta,
    });

    const row = await this.repository.findOffering(vendorId, giftTemplateId);
    if (!row) {
      throw new NotFoundException('This vendor has no offering for that gift.');
    }
    return toOfferingView(row, vendor.commission_rate);
  }

  /** Says no to a vendor's new price. The current price stays; the vendor sees the request gone. */
  async declinePriceChange(
    vendorId: string,
    giftTemplateId: string,
    staff: StaffContext,
    meta: RequestMeta,
  ): Promise<OfferingView> {
    const vendor = await this.requireVendor(vendorId);
    const existing = await this.repository.findOffering(
      vendorId,
      giftTemplateId,
    );
    if (!existing || existing.proposed_price === null) {
      throw new NotFoundException('There is no price request for that gift.');
    }

    await this.repository.setProposedPrice(vendorId, giftTemplateId, null);
    await this.audit.record({
      eventType: 'vendor_offering.price_change_declined',
      actorId: staff.userId,
      actorType: 'admin',
      resourceType: 'vendor',
      resourceId: vendorId,
      metadata: {
        giftTemplateId,
        declinedPrice: existing.proposed_price,
        basePrice: existing.gift_templates?.base_price ?? null,
      },
      ...meta,
    });

    return toOfferingView(
      { ...existing, proposed_price: null, price_proposed_at: null },
      vendor.commission_rate,
    );
  }

  private async requireVendor(id: string): Promise<VendorRow> {
    const row = await this.repository.findById(id);
    if (!row) {
      throw new NotFoundException('Vendor not found');
    }
    return row;
  }

  private async requireBackupVendor(id: string): Promise<void> {
    const row = await this.repository.findById(id);
    if (!row) {
      throw new BadRequestException('Backup vendor not found.');
    }
  }
}
