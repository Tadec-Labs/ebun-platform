import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { StaffContext } from '../auth/staff.guard';
import { GiftsService } from '../gifts/gifts.service';
import {
  CreateVendorDto,
  UpdateVendorDto,
  UpsertOfferingDto,
} from './dto/vendor.dto';
import {
  OfferingRow,
  VendorRow,
  VendorSummaryRow,
  VendorsRepository,
} from './vendors.repository';

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
  offeringsCount: number;
  createdAt: string;
}

export interface VendorView {
  id: string;
  businessName: string;
  ownerName: string;
  whatsappNumber: string;
  email: string | null;
  category: VendorRow['category'];
  subcategories: string[];
  serviceAreas: string[];
  deliveryZones: string[];
  /** The vendor's SHARE of gift value (0.70 = vendor gets 70%, Ebun keeps 30%) — despite the column name. */
  commissionRate: number;
  bankName: string | null;
  accountNumber: string | null;
  accountName: string | null;
  active: boolean;
  verified: boolean;
  totalOrders: number;
  responseTimeoutMinutes: number;
  backupVendorId: string | null;
  notes: string | null;
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
}

const FIELD_MAP: Record<string, string> = {
  businessName: 'business_name',
  ownerName: 'owner_name',
  whatsappNumber: 'whatsapp_number',
  email: 'email',
  category: 'category',
  subcategories: 'subcategories',
  serviceAreas: 'service_areas',
  deliveryZones: 'delivery_zones',
  commissionRate: 'commission_rate',
  bankName: 'bank_name',
  accountNumber: 'account_number',
  accountName: 'account_name',
  responseTimeoutMinutes: 'response_timeout_minutes',
  backupVendorId: 'backup_vendor_id',
  notes: 'notes',
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
    offeringsCount,
    createdAt: row.created_at,
  };
}

function toView(row: VendorRow): VendorView {
  return {
    id: row.id,
    portalToken: row.portal_token,
    portalTokenRotatedAt: row.portal_token_rotated_at,
    businessName: row.business_name,
    ownerName: row.owner_name,
    whatsappNumber: row.whatsapp_number,
    email: row.email,
    category: row.category,
    subcategories: row.subcategories ?? [],
    serviceAreas: row.service_areas ?? [],
    deliveryZones: row.delivery_zones ?? [],
    commissionRate: row.commission_rate,
    bankName: row.bank_name,
    accountNumber: row.account_number,
    accountName: row.account_name,
    active: row.active,
    verified: row.verified,
    totalOrders: row.total_orders,
    responseTimeoutMinutes: row.response_timeout_minutes,
    backupVendorId: row.backup_vendor_id,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toOfferingView(row: OfferingRow): OfferingView {
  const senderPrice = row.gift_templates?.base_price ?? 0;
  const ebunMargin = senderPrice - row.vendor_price;
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
  };
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
  ) {}

  async list(): Promise<VendorSummaryView[]> {
    const [vendors, counts] = await Promise.all([
      this.repository.list(),
      this.repository.countOfferingsByVendor(),
    ]);
    return vendors.map((v) => toSummaryView(v, counts[v.id] ?? 0));
  }

  async get(id: string): Promise<VendorView> {
    return toView(await this.requireVendor(id));
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

    return toView(row);
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
      return toView(existing); // nothing actually changed — no write, no audit noise
    }

    const patch: Record<string, unknown> = {};
    for (const column of changedColumns) patch[column] = values[column];

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

    return toView(updated);
  }

  async listOfferings(vendorId: string): Promise<OfferingView[]> {
    await this.requireVendor(vendorId);
    const rows = await this.repository.listOfferings(vendorId);
    return rows.map(toOfferingView);
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
    await this.requireVendor(vendorId);
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

    return toOfferingView(row);
  }

  async removeOffering(
    vendorId: string,
    giftTemplateId: string,
    staff: StaffContext,
    meta: RequestMeta,
  ): Promise<void> {
    await this.requireVendor(vendorId);

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
