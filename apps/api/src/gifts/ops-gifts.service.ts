import { Injectable, NotFoundException } from '@nestjs/common';
import { FulfillmentType } from '@ebun/types';
import { AuditService } from '../audit/audit.service';
import type { StaffContext } from '../auth/staff.guard';
import {
  CreateGiftTemplateDto,
  UpdateGiftTemplateDto,
} from './dto/gift-template.dto';
import {
  GiftTemplateRow,
  GiftTemplatesRepository,
} from './gift-templates.repository';

export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

/** The catalogue as ops sees it — withheld gifts included, prices in kobo. */
export interface GiftTemplateView {
  id: string;
  name: string;
  description: string | null;
  category: GiftTemplateRow['category'];
  basePrice: number;
  deliveryType: FulfillmentType;
  deliveryWindow: string | null;
  imageUrl: string | null;
  requiresAddress: boolean;
  available: boolean;
  featured: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

const FIELD_MAP: Record<string, string> = {
  name: 'name',
  description: 'description',
  category: 'category',
  basePrice: 'base_price',
  deliveryType: 'delivery_type',
  deliveryWindow: 'delivery_window',
  imageUrl: 'image_url',
  requiresAddress: 'requires_address',
  available: 'available',
  featured: 'featured',
  sortOrder: 'sort_order',
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

function toView(row: GiftTemplateRow): GiftTemplateView {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    basePrice: row.base_price,
    deliveryType: row.delivery_type,
    deliveryWindow: row.delivery_window,
    imageUrl: row.image_url,
    requiresAddress: row.requires_address,
    available: row.available,
    featured: row.featured,
    sortOrder: (row.sort_order as number | undefined) ?? 0,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/**
 * Catalogue management for ops.
 *
 * Before this, the only way to add or change a gift was to write a SQL
 * migration and run `supabase db push` — which makes the catalogue, the
 * thing the whole product is browsing, the single least editable part of
 * the system. Onboarding a vendor and listing what they sell is one
 * conversation; it should not need a deploy.
 *
 * Kept apart from GiftsService, which stays the read-only surface the
 * order and fulfilment paths depend on. Nothing here is reachable
 * without a staff session.
 */
@Injectable()
export class OpsGiftsService {
  constructor(
    private readonly repository: GiftTemplatesRepository,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<GiftTemplateView[]> {
    const rows = await this.repository.findAllForOps();
    return rows.map(toView);
  }

  async get(id: string): Promise<GiftTemplateView> {
    const row = await this.repository.findById(id);
    if (!row) {
      throw new NotFoundException('Gift not found.');
    }
    return toView(row);
  }

  async create(
    dto: CreateGiftTemplateDto,
    staff: StaffContext,
    meta: RequestMeta,
  ): Promise<GiftTemplateView> {
    const row = await this.repository.create({
      ...toRowValues(dto),
      // A new gift is a draft unless ops says otherwise. The column
      // itself defaults to true, which is the wrong default for a row
      // created mid-meeting from a price nobody has checked.
      available: dto.available ?? false,
    });

    await this.audit.record({
      eventType: 'GIFT_TEMPLATE_CREATED',
      actorId: staff.userId,
      actorType: 'admin',
      resourceType: 'gift_template',
      resourceId: row.id,
      newState: row.available ? 'available' : 'withheld',
      metadata: { name: row.name, basePrice: row.base_price },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return toView(row);
  }

  async update(
    id: string,
    dto: UpdateGiftTemplateDto,
    staff: StaffContext,
    meta: RequestMeta,
  ): Promise<GiftTemplateView> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new NotFoundException('Gift not found.');
    }

    const requested = toRowValues(dto);
    const changed: Record<string, unknown> = {};
    for (const [column, value] of Object.entries(requested)) {
      if (!sameValue(existing[column], value)) {
        changed[column] = value;
      }
    }

    // Nothing actually different — don't write, and don't put a
    // no-op in an append-only audit log.
    if (Object.keys(changed).length === 0) {
      return toView(existing);
    }

    const row = await this.repository.update(id, changed);
    if (!row) {
      throw new NotFoundException('Gift not found.');
    }

    await this.audit.record({
      eventType: 'GIFT_TEMPLATE_UPDATED',
      actorId: staff.userId,
      actorType: 'admin',
      resourceType: 'gift_template',
      resourceId: row.id,
      previousState: existing.available ? 'available' : 'withheld',
      newState: row.available ? 'available' : 'withheld',
      metadata: {
        // Field NAMES, plus the two values that change what a customer
        // can buy and for how much. Everything else stays out.
        changedFields: Object.keys(changed).sort(),
        ...(changed.base_price !== undefined
          ? { basePriceFrom: existing.base_price, basePriceTo: row.base_price }
          : {}),
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return toView(row);
  }
}
