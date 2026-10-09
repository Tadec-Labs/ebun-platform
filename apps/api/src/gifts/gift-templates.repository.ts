import { Inject, Injectable } from '@nestjs/common';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { FulfillmentType } from '@ebun/types';
import { SUPABASE_CLIENT } from '../supabase/supabase.module';

export interface GiftTemplateRow {
  id: string;
  name: string;
  description: string | null;
  category: 'food' | 'experience' | 'keepsake' | 'utility'; // matches the schema's check constraint
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
}
