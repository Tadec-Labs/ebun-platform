import { Inject, Injectable } from '@nestjs/common';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { FulfillmentType } from '@ebun/types';
import { SUPABASE_CLIENT } from '../supabase/supabase.module';

export interface GiftTemplateRow {
  id: string;
  base_price: number; // kobo
  available: boolean;
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
}
