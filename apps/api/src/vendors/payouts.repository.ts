import { Inject, Injectable } from '@nestjs/common';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/supabase.module';

/** One gift this vendor handed over, and whether SendEbun has paid for it yet. */
export interface CollectionRow {
  id: string;
  order_number: string | null;
  vendor_payout_amount: number; // kobo
  vendor_paid_at: string | null;
  vendor_payout_id: string | null;
  updated_at: string;
  gift_templates: { name: string } | null;
  // orders.id is unique on redemptions, so PostgREST may embed this as an
  // object or a one-element array depending on how it reads the FK.
  redemptions:
    { completed_at: string | null } | { completed_at: string | null }[] | null;
  /** Doorstep gifts: handed over at the door rather than at a counter. Same one-to-one embed. */
  gift_fulfillments?:
    { delivered_at: string | null } | { delivered_at: string | null }[] | null;
}

/**
 * A transfer SendEbun made to the vendor. The bank details snapshotted
 * on the row are deliberately not selected: the vendor portal's credential
 * lives on a counter phone, and ops already sees the vendor's account.
 */
export interface PayoutRow {
  id: string;
  net_payout: number; // kobo
  orders_count: number;
  paid_at: string | null;
  payment_method: string | null;
  payment_ref: string | null;
  notes: string | null;
}

const COLLECTION_COLUMNS =
  'id, order_number, vendor_payout_amount, vendor_paid_at, vendor_payout_id, updated_at, gift_templates!gift_template_id(name), redemptions(completed_at), gift_fulfillments(delivered_at)';

const PAYOUT_COLUMNS =
  'id, net_payout, orders_count, paid_at, payment_method, payment_ref, notes';

/** Raised by record_vendor_payout() when the listed collections aren't all this vendor's unpaid ones. */
export class PayoutOrdersChangedError extends Error {}

@Injectable()
export class PayoutsRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  /** Every collection credited to this vendor (paid or not), most recent first. */
  async listCollections(
    vendorId: string,
    limit: number,
  ): Promise<CollectionRow[]> {
    const response = (await this.supabase
      .from('orders')
      .select(COLLECTION_COLUMNS)
      .eq('vendor_id', vendorId)
      .not('vendor_payout_amount', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(limit)) as {
      data: CollectionRow[] | null;
      error: PostgrestError | null;
    };
    if (response.error) throw response.error;
    return response.data ?? [];
  }

  async listPayouts(vendorId: string, limit: number): Promise<PayoutRow[]> {
    const response = (await this.supabase
      .from('vendor_payouts')
      .select(PAYOUT_COLUMNS)
      .eq('vendor_id', vendorId)
      .order('paid_at', { ascending: false })
      .limit(limit)) as {
      data: PayoutRow[] | null;
      error: PostgrestError | null;
    };
    if (response.error) throw response.error;
    return response.data ?? [];
  }

  /**
   * Atomic: see record_vendor_payout() in
   * 20261013120000_vendor_payout_recording.sql. The amount is computed in
   * the database from the listed collections, never passed in.
   */
  async recordPayout(params: {
    vendorId: string;
    orderIds: string[];
    paymentRef: string;
    paymentMethod: string;
    notes: string | null;
    recordedBy: string;
  }): Promise<PayoutRow> {
    const response = (await this.supabase.rpc('record_vendor_payout', {
      p_vendor_id: params.vendorId,
      p_order_ids: params.orderIds,
      p_payment_ref: params.paymentRef,
      p_payment_method: params.paymentMethod,
      p_notes: params.notes,
      p_recorded_by: params.recordedBy,
    })) as { data: PayoutRow | null; error: PostgrestError | null };

    if (response.error) {
      if (response.error.message?.includes('payout_orders_invalid')) {
        throw new PayoutOrdersChangedError();
      }
      throw response.error;
    }
    if (!response.data) {
      throw new Error('record_vendor_payout returned no row');
    }
    return response.data;
  }
}
