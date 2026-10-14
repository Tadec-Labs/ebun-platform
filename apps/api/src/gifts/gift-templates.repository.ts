import { Inject, Injectable } from '@nestjs/common';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { FulfillmentType } from '@ebun/types';
import type { BookingStyle, GiftCategory } from '@ebun/types';
import { SUPABASE_CLIENT } from '../supabase/supabase.module';

export interface GiftTemplateRow {
  id: string;
  name: string;
  description: string | null;
  category: GiftCategory; // matches the schema's check constraint
  occasions: string[];
  booking_style: BookingStyle;
  image_url: string | null;
  base_price: number; // kobo
  available: boolean;
  featured: boolean;
  delivery_window: string | null; // human-readable, e.g. '2-4hrs', 'instant'
  requires_address: boolean;
  // Column name is `delivery_type` in the schema; typed here as
  // FulfillmentType (not a bespoke string union) since it's the same
  // Postgres enum gift_fulfillments.fulfillment_type uses — this is
  // what fulfillment orchestration branches on.
  delivery_type: FulfillmentType;
  [key: string]: unknown;
}

/** One vendor's offering of a gift, with the vendor's name and switch. */
export interface GiftSellerRow {
  gift_template_id: string;
  vendor_id: string;
  vendor_price: number;
  available_zones: string[] | null;
  available: boolean;
  approved: boolean;
  vendors: { business_name: string; active: boolean } | null;
}

@Injectable()
export class GiftTemplatesRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async findById(id: string): Promise<GiftTemplateRow | null> {
    const response = (await this.supabase
      .from('gift_templates')
      .select('*')
      .eq('id', id)
      .maybeSingle()) as {
      data: GiftTemplateRow | null;
      error: PostgrestError | null;
    };

    if (response.error) {
      throw response.error;
    }

    return response.data ?? null;
  }

  /**
   * Backs GET /gifts — the public catalog. `available` is the seller-
   * facing flag (a template ops has pulled from sale entirely); this
   * is deliberately NOT the same check as findAvailableById's, which
   * exists to guard a single order-creation attempt rather than decide
   * what's worth listing.
   */
  async findAllAvailable(): Promise<GiftTemplateRow[]> {
    const response = (await this.supabase
      .from('gift_templates')
      .select('*')
      .eq('available', true)
      .order('sort_order', { ascending: true })) as {
      data: GiftTemplateRow[] | null;
      error: PostgrestError | null;
    };

    if (response.error) {
      throw response.error;
    }

    return response.data ?? [];
  }

  /**
   * The ops catalogue view: every template, including ones pulled from
   * sale. findAllAvailable() deliberately hides those because it backs
   * the public GET /gifts; ops needs to see exactly what it is hiding,
   * which is the whole reason a withheld gift is a row rather than a
   * deletion.
   */
  async findAllForOps(): Promise<GiftTemplateRow[]> {
    const response = (await this.supabase
      .from('gift_templates')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })) as {
      data: GiftTemplateRow[] | null;
      error: PostgrestError | null;
    };

    if (response.error) {
      throw response.error;
    }
    return response.data ?? [];
  }

  async create(values: Record<string, unknown>): Promise<GiftTemplateRow> {
    const response = (await this.supabase
      .from('gift_templates')
      .insert(values)
      .select()
      .single()) as {
      data: GiftTemplateRow | null;
      error: PostgrestError | null;
    };

    if (response.error) {
      throw response.error;
    }
    if (!response.data) {
      throw new Error('Gift template insert returned no data');
    }
    return response.data;
  }

  async update(
    id: string,
    values: Record<string, unknown>,
  ): Promise<GiftTemplateRow | null> {
    const response = (await this.supabase
      .from('gift_templates')
      .update({ ...values, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .maybeSingle()) as {
      data: GiftTemplateRow | null;
      error: PostgrestError | null;
    };

    if (response.error) {
      throw response.error;
    }
    return response.data ?? null;
  }

  /**
   * Gifts that at least one vendor can hand over right now: an offering
   * that ops has approved, that the vendor hasn't marked sold out, at a
   * vendor that is still active.
   *
   * Existence only — no prices are read. The active filter is applied
   * in code rather than as a PostgREST filter on the embedded vendor,
   * for the same reason as VendorsRepository.listCollectionPoints: the
   * set is small and embed-filter semantics are easy to get wrong.
   */
  /**
   * Who sells which gift, for ops. One query for the whole catalogue (or
   * one gift): the catalogue is tens of rows, and ops needs to see, per
   * gift, exactly why it is or isn't reaching senders.
   */
  async findSellersForOps(giftTemplateId?: string): Promise<GiftSellerRow[]> {
    let query = this.supabase
      .from('vendor_gift_offerings')
      .select(
        'gift_template_id, vendor_id, vendor_price, available_zones, available, approved, vendors(business_name, active)',
      );
    if (giftTemplateId) query = query.eq('gift_template_id', giftTemplateId);
    const response = (await query) as {
      data: GiftSellerRow[] | null;
      error: PostgrestError | null;
    };
    if (response.error) throw response.error;
    return response.data ?? [];
  }

  /** True when any order or group gift points at this template — it then can't be deleted, only taken off sale. */
  async isReferenced(id: string): Promise<boolean> {
    const [orders, swapped, groups] = await Promise.all([
      this.supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('gift_template_id', id),
      this.supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('swapped_to_template_id', id),
      this.supabase
        .from('group_gifts')
        .select('id', { count: 'exact', head: true })
        .eq('gift_template_id', id),
    ]);
    for (const r of [orders, swapped, groups]) {
      if (r.error) throw r.error;
    }
    return (orders.count ?? 0) + (swapped.count ?? 0) + (groups.count ?? 0) > 0;
  }

  /** Offerings go with it (ON DELETE CASCADE). Null when no such row. */
  async delete(id: string): Promise<GiftTemplateRow | null> {
    const response = (await this.supabase
      .from('gift_templates')
      .delete()
      .eq('id', id)
      .select()
      .maybeSingle()) as {
      data: GiftTemplateRow | null;
      error: PostgrestError | null;
    };
    if (response.error) throw response.error;
    return response.data ?? null;
  }

  async findTemplateIdsWithAvailableVendor(): Promise<Set<string>> {
    const response = (await this.supabase
      .from('vendor_gift_offerings')
      .select('gift_template_id, vendors(active)')
      .eq('approved', true)
      .eq('available', true)) as {
      data:
        | { gift_template_id: string; vendors: { active: boolean } | null }[]
        | null;
      error: PostgrestError | null;
    };

    if (response.error) {
      throw response.error;
    }
    return new Set(
      (response.data ?? [])
        .filter((row) => row.vendors?.active === true)
        .map((row) => row.gift_template_id),
    );
  }
}
