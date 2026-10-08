import { Inject, Injectable } from '@nestjs/common';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/supabase.module';

export interface VendorRow {
  id: string;
  business_name: string;
  owner_name: string;
  whatsapp_number: string;
  email: string | null;
  category: 'food' | 'experience' | 'keepsake' | 'utility';
  subcategories: string[] | null;
  service_areas: string[] | null;
  delivery_zones: string[] | null;
  commission_rate: number;
  bank_name: string | null;
  account_number: string | null;
  account_name: string | null;
  active: boolean;
  verified: boolean;
  rating: number | null;
  total_orders: number;
  response_timeout_minutes: number;
  backup_vendor_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** The list view never selects bank details — they only travel on the single-vendor read. */
export type VendorSummaryRow = Pick<
  VendorRow,
  | 'id'
  | 'business_name'
  | 'owner_name'
  | 'whatsapp_number'
  | 'category'
  | 'service_areas'
  | 'delivery_zones'
  | 'active'
  | 'verified'
  | 'total_orders'
  | 'created_at'
>;

export interface OfferingRow {
  vendor_id: string;
  gift_template_id: string;
  vendor_price: number; // kobo
  available_zones: string[] | null;
  available: boolean;
  approved: boolean;
  gift_templates: { name: string; base_price: number } | null;
}

const SUMMARY_COLUMNS =
  'id, business_name, owner_name, whatsapp_number, category, service_areas, delivery_zones, active, verified, total_orders, created_at';

const OFFERING_COLUMNS =
  'vendor_id, gift_template_id, vendor_price, available_zones, available, approved, gift_templates(name, base_price)';

@Injectable()
export class VendorsRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async list(): Promise<VendorSummaryRow[]> {
    const response = (await this.supabase
      .from('vendors')
      .select(SUMMARY_COLUMNS)
      .order('created_at', { ascending: false })) as {
      data: VendorSummaryRow[] | null;
      error: PostgrestError | null;
    };
    if (response.error) throw response.error;
    return response.data ?? [];
  }

  /** vendor_id -> number of offerings, for the list view. Two cheap queries beat a join this small. */
  async countOfferingsByVendor(): Promise<Record<string, number>> {
    const response = (await this.supabase
      .from('vendor_gift_offerings')
      .select('vendor_id')) as {
      data: { vendor_id: string }[] | null;
      error: PostgrestError | null;
    };
    if (response.error) throw response.error;

    const counts: Record<string, number> = {};
    for (const row of response.data ?? []) {
      counts[row.vendor_id] = (counts[row.vendor_id] ?? 0) + 1;
    }
    return counts;
  }

  async findById(id: string): Promise<VendorRow | null> {
    const response = (await this.supabase
      .from('vendors')
      .select('*')
      .eq('id', id)
      .maybeSingle()) as {
      data: VendorRow | null;
      error: PostgrestError | null;
    };
    if (response.error) throw response.error;
    return response.data ?? null;
  }

  async create(values: Record<string, unknown>): Promise<VendorRow> {
    const response = (await this.supabase
      .from('vendors')
      .insert(values)
      .select('*')
      .single()) as {
      data: VendorRow | null;
      error: PostgrestError | null;
    };
    if (response.error) throw response.error;
    if (!response.data) {
      throw new Error('vendors insert returned no row');
    }
    return response.data;
  }

  /** Null if the row vanished between the caller's read and this write. */
  async update(
    id: string,
    values: Record<string, unknown>,
  ): Promise<VendorRow | null> {
    const response = (await this.supabase
      .from('vendors')
      .update({ ...values, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .maybeSingle()) as {
      data: VendorRow | null;
      error: PostgrestError | null;
    };
    if (response.error) throw response.error;
    return response.data ?? null;
  }

  async listOfferings(vendorId: string): Promise<OfferingRow[]> {
    const response = (await this.supabase
      .from('vendor_gift_offerings')
      .select(OFFERING_COLUMNS)
      .eq('vendor_id', vendorId)) as {
      data: OfferingRow[] | null;
      error: PostgrestError | null;
    };
    if (response.error) throw response.error;
    return response.data ?? [];
  }

  async upsertOffering(values: {
    vendor_id: string;
    gift_template_id: string;
    vendor_price: number;
    available_zones: string[] | null;
    available: boolean;
    approved: boolean;
  }): Promise<OfferingRow> {
    const response = (await this.supabase
      .from('vendor_gift_offerings')
      .upsert(values, { onConflict: 'vendor_id,gift_template_id' })
      .select(OFFERING_COLUMNS)
      .single()) as {
      data: OfferingRow | null;
      error: PostgrestError | null;
    };
    if (response.error) throw response.error;
    if (!response.data) {
      throw new Error('vendor_gift_offerings upsert returned no row');
    }
    return response.data;
  }

  /** True if a row was actually deleted. */
  async deleteOffering(
    vendorId: string,
    giftTemplateId: string,
  ): Promise<boolean> {
    const response = (await this.supabase
      .from('vendor_gift_offerings')
      .delete()
      .eq('vendor_id', vendorId)
      .eq('gift_template_id', giftTemplateId)
      .select('gift_template_id')) as {
      data: { gift_template_id: string }[] | null;
      error: PostgrestError | null;
    };
    if (response.error) throw response.error;
    return (response.data ?? []).length > 0;
  }
}
