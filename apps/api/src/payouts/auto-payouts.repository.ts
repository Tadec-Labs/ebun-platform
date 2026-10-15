import { Inject, Injectable } from '@nestjs/common';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/supabase.module';

export type TransferStatus =
  'claimed' | 'processing' | 'success' | 'failed' | 'reversed';

export interface TransferRow {
  id: string;
  vendor_id: string;
  order_ids: string[];
  amount: number; // kobo
  reference: string;
  status: TransferStatus;
  paystack_transfer_code: string | null;
  failure_reason: string | null;
  payout_id: string | null;
  created_at: string;
  updated_at: string;
}

/** What paying a vendor needs to know about them — bank details included, so this never leaves the API. */
export interface PayableVendorRow {
  id: string;
  business_name: string;
  active: boolean;
  bank_code: string | null;
  account_number: string | null;
  account_name: string | null;
  paystack_recipient_code: string | null;
}

const TRANSFER_COLUMNS =
  'id, vendor_id, order_ids, amount, reference, status, paystack_transfer_code, failure_reason, payout_id, created_at, updated_at';

type Result<T> = { data: T | null; error: PostgrestError | null };

/**
 * Every query automatic payouts make. The three that move or settle money
 * — claim, complete, release — are SQL functions that lock what they
 * touch (see 20261015200000_automatic_vendor_payouts.sql).
 */
@Injectable()
export class AutoPayoutsRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async findVendor(vendorId: string): Promise<PayableVendorRow | null> {
    const response = (await this.supabase
      .from('vendors')
      .select(
        'id, business_name, active, bank_code, account_number, account_name, paystack_recipient_code',
      )
      .eq('id', vendorId)
      .maybeSingle()) as Result<PayableVendorRow>;
    if (response.error) throw response.error;
    return response.data ?? null;
  }

  /**
   * Stores the Paystack recipient — only if the account it was made for
   * is still the one on file. Ops changing the bank details at the same
   * moment wins; the next payout makes a fresh recipient.
   */
  async saveRecipientCode(
    vendorId: string,
    recipientCode: string,
    forAccount: { accountNumber: string; bankCode: string },
  ): Promise<void> {
    const { error } = await this.supabase
      .from('vendors')
      .update({ paystack_recipient_code: recipientCode })
      .eq('id', vendorId)
      .eq('account_number', forAccount.accountNumber)
      .eq('bank_code', forAccount.bankCode);
    if (error) throw error;
  }

  /** One transfer for everything this vendor is owed and nobody is paying yet; null when there's nothing. */
  async claim(
    vendorId: string,
    reference: string,
  ): Promise<TransferRow | null> {
    const response = (await this.supabase.rpc('claim_vendor_transfer', {
      p_vendor_id: vendorId,
      p_reference: reference,
    })) as Result<TransferRow[]>;
    if (response.error) throw response.error;
    return response.data?.[0] ?? null;
  }

  async markProcessing(
    transferId: string,
    transferCode: string | null,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('vendor_transfers')
      .update({
        status: 'processing',
        ...(transferCode ? { paystack_transfer_code: transferCode } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', transferId)
      .in('status', ['claimed', 'processing']);
    if (error) throw error;
  }

  /**
   * Something needs a person but the transfer may still complete (e.g.
   * Paystack is waiting for an OTP). Stays in flight — releasing it could
   * pay twice if someone then approves it in the dashboard.
   */
  async noteProblem(transferId: string, reason: string): Promise<void> {
    const { error } = await this.supabase
      .from('vendor_transfers')
      .update({
        status: 'processing',
        failure_reason: reason.slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq('id', transferId)
      .in('status', ['claimed', 'processing']);
    if (error) throw error;
  }

  /** The money arrived: recorded as a payout, orders marked paid. Idempotent. */
  async complete(
    transferId: string,
    transferCode: string | null,
  ): Promise<TransferRow> {
    const response = (await this.supabase.rpc('complete_vendor_transfer', {
      p_transfer_id: transferId,
      p_transfer_code: transferCode,
    })) as Result<TransferRow>;
    if (response.error) throw response.error;
    if (!response.data)
      throw new Error('complete_vendor_transfer returned nothing');
    return response.data;
  }

  /** It didn't go through: orders go back to "owed" for the next attempt. */
  async release(
    transferId: string,
    status: 'failed' | 'reversed',
    reason: string,
  ): Promise<TransferRow> {
    const response = (await this.supabase.rpc('release_vendor_transfer', {
      p_transfer_id: transferId,
      p_status: status,
      p_reason: reason,
    })) as Result<TransferRow>;
    if (response.error) throw response.error;
    if (!response.data)
      throw new Error('release_vendor_transfer returned nothing');
    return response.data;
  }

  async findByReference(reference: string): Promise<TransferRow | null> {
    const response = (await this.supabase
      .from('vendor_transfers')
      .select(TRANSFER_COLUMNS)
      .eq('reference', reference)
      .maybeSingle()) as Result<TransferRow>;
    if (response.error) throw response.error;
    return response.data ?? null;
  }

  /** In flight for longer than `olderThan` with no word from Paystack — worth asking about. */
  async listUnsettled(olderThan: Date, limit: number): Promise<TransferRow[]> {
    const response = (await this.supabase
      .from('vendor_transfers')
      .select(TRANSFER_COLUMNS)
      .in('status', ['claimed', 'processing'])
      .lt('updated_at', olderThan.toISOString())
      .order('updated_at', { ascending: true })
      .limit(limit)) as Result<TransferRow[]>;
    if (response.error) throw response.error;
    return response.data ?? [];
  }

  /** Failed attempts for this vendor since `since` — after a few, stop retrying until a person looks. */
  async countFailuresSince(vendorId: string, since: Date): Promise<number> {
    const response = (await this.supabase
      .from('vendor_transfers')
      .select('id', { count: 'exact', head: true })
      .eq('vendor_id', vendorId)
      .in('status', ['failed', 'reversed'])
      .gte('updated_at', since.toISOString())) as {
      count: number | null;
      error: PostgrestError | null;
    };
    if (response.error) throw response.error;
    return response.count ?? 0;
  }

  /** Vendors owed for handovers that no transfer is paying yet. */
  async vendorsOwed(limit: number): Promise<string[]> {
    const response = (await this.supabase
      .from('orders')
      .select('vendor_id')
      .not('vendor_payout_amount', 'is', null)
      .is('vendor_paid_at', null)
      .is('vendor_transfer_id', null)
      .not('vendor_id', 'is', null)
      .limit(1000)) as Result<{ vendor_id: string }[]>;
    if (response.error) throw response.error;
    return [...new Set((response.data ?? []).map((r) => r.vendor_id))].slice(
      0,
      limit,
    );
  }

  /** Latest attempt per vendor that failed and hasn't been followed by a success — for /ops Today. */
  async recentFailures(
    since: Date,
  ): Promise<(TransferRow & { vendors: { business_name: string } | null })[]> {
    const response = (await this.supabase
      .from('vendor_transfers')
      .select(`${TRANSFER_COLUMNS}, vendors(business_name)`)
      .gte('updated_at', since.toISOString())
      .order('updated_at', { ascending: false })
      .limit(200)) as Result<
      (TransferRow & { vendors: { business_name: string } | null })[]
    >;
    if (response.error) throw response.error;
    const latest = new Map<
      string,
      TransferRow & { vendors: { business_name: string } | null }
    >();
    for (const row of response.data ?? []) {
      if (!latest.has(row.vendor_id)) latest.set(row.vendor_id, row);
    }
    return [...latest.values()].filter(
      (row) =>
        row.status === 'failed' ||
        row.status === 'reversed' ||
        (row.status === 'processing' && row.failure_reason !== null),
    );
  }
}
