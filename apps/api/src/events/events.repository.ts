import { Inject, Injectable } from '@nestjs/common';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/supabase.module';
import type { EventType } from './events.config';

export type EventStatus = 'active' | 'closed' | 'cancelled';
export type CashGiftStatus =
  'pending' | 'confirmed' | 'late' | 'failed' | 'refunded';
export type RefundStatus =
  'pending' | 'submitting' | 'processing' | 'completed' | 'failed';
export type ConfirmCashResult =
  'confirmed' | 'late' | 'over_cap' | 'already_applied';

export interface EventRow {
  id: string;
  slug: string;
  host_token: string;
  host_id: string;
  host_name: string;
  host_phone: string;
  event_type: EventType;
  title: string;
  event_date: string;
  city: string;
  gift_list_enabled: boolean;
  cash_enabled: boolean;
  wall_enabled: boolean;
  show_amounts: boolean;
  status: EventStatus;
  cash_raised: number;
  cash_count: number;
  verified_at: string | null;
  payout_bank_code: string | null;
  payout_account_number: string | null;
  payout_account_name: string | null;
  payout_status: 'none' | 'paid';
  payout_amount: number | null;
  payout_reference: string | null;
  paid_out_at: string | null;
  closed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
}

export interface CashGiftRow {
  id: string;
  event_id: string;
  guest_name: string;
  guest_phone: string | null;
  message: string | null;
  show_on_wall: boolean;
  show_amount: boolean;
  amount: number;
  service_fee: number;
  total_amount: number;
  paystack_reference: string;
  status: CashGiftStatus;
  confirmed_at: string | null;
  refund_status: RefundStatus | null;
  refund_amount: number | null;
  refund_attempts: number;
  refund_error: string | null;
  thanked_at: string | null;
  created_at: string;
}

const EVENT_COLUMNS =
  'id, slug, host_token, host_id, host_name, host_phone, event_type, title, event_date, city, gift_list_enabled, cash_enabled, wall_enabled, show_amounts, status, cash_raised, cash_count, verified_at, payout_bank_code, payout_account_number, payout_account_name, payout_status, payout_amount, payout_reference, paid_out_at, closed_at, cancelled_at, created_at';

// Never the guest's email: nothing that reads these rows shows it.
const GIFT_COLUMNS =
  'id, event_id, guest_name, guest_phone, message, show_on_wall, show_amount, amount, service_fee, total_amount, paystack_reference, status, confirmed_at, refund_status, refund_amount, refund_attempts, refund_error, thanked_at, created_at';

type Result<T> = { data: T | null; error: PostgrestError | null };

function unwrap<T>(response: Result<T>): T | null {
  if (response.error) throw response.error;
  return response.data ?? null;
}

export const UNIQUE_VIOLATION = '23505';

/**
 * Every query events make. Money writes (counting a cash gift, closing,
 * cancelling, recording a payout) are the locked SQL functions in
 * 20261101090000_events.sql; everything here is a read or a guarded
 * single-row update.
 */
@Injectable()
export class EventsRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async create(row: {
    slug: string;
    host_id: string;
    host_name: string;
    host_phone: string;
    event_type: EventType;
    title: string;
    event_date: string;
    city: string;
    gift_list_enabled: boolean;
    cash_enabled: boolean;
    wall_enabled: boolean;
    show_amounts: boolean;
  }): Promise<EventRow> {
    const created = unwrap(
      (await this.supabase
        .from('events')
        .insert(row)
        .select(EVENT_COLUMNS)
        .single()) as Result<EventRow>,
    );
    if (!created) throw new Error('events insert returned no row');
    return created;
  }

  async findBySlug(slug: string): Promise<EventRow | null> {
    return unwrap(
      (await this.supabase
        .from('events')
        .select(EVENT_COLUMNS)
        .eq('slug', slug)
        .maybeSingle()) as Result<EventRow>,
    );
  }

  async findByHostToken(token: string): Promise<EventRow | null> {
    return unwrap(
      (await this.supabase
        .from('events')
        .select(EVENT_COLUMNS)
        .eq('host_token', token)
        .maybeSingle()) as Result<EventRow>,
    );
  }

  async findById(id: string): Promise<EventRow | null> {
    return unwrap(
      (await this.supabase
        .from('events')
        .select(EVENT_COLUMNS)
        .eq('id', id)
        .maybeSingle()) as Result<EventRow>,
    );
  }

  /** Settings only, and only while the event is active. */
  async update(
    id: string,
    changes: Partial<
      Pick<
        EventRow,
        | 'title'
        | 'city'
        | 'gift_list_enabled'
        | 'cash_enabled'
        | 'wall_enabled'
        | 'show_amounts'
      >
    >,
  ): Promise<EventRow | null> {
    const rows = unwrap(
      (await this.supabase
        .from('events')
        .update(changes)
        .eq('id', id)
        .eq('status', 'active')
        .select(EVENT_COLUMNS)) as Result<EventRow[]>,
    );
    return rows?.[0] ?? null;
  }

  /**
   * Sets the payout account and clears any verification: a new account
   * must be checked again before money moves. Not after a payout.
   */
  async setPayoutAccount(
    id: string,
    account: { bankCode: string; accountNumber: string; accountName: string },
  ): Promise<boolean> {
    const rows = unwrap(
      (await this.supabase
        .from('events')
        .update({
          payout_bank_code: account.bankCode,
          payout_account_number: account.accountNumber,
          payout_account_name: account.accountName,
          verified_at: null,
          verified_by: null,
        })
        .eq('id', id)
        .eq('payout_status', 'none')
        .neq('status', 'cancelled')
        .select('id')) as Result<{ id: string }[]>,
    );
    return (rows?.length ?? 0) === 1;
  }

  async verify(id: string, staffId: string): Promise<boolean> {
    const rows = unwrap(
      (await this.supabase
        .from('events')
        .update({ verified_at: new Date().toISOString(), verified_by: staffId })
        .eq('id', id)
        .eq('payout_status', 'none')
        .not('payout_account_number', 'is', null)
        .select('id')) as Result<{ id: string }[]>,
    );
    return (rows?.length ?? 0) === 1;
  }

  /** For ops: events with cash, newest date first. */
  async listForOps(limit: number): Promise<EventRow[]> {
    return (
      unwrap(
        (await this.supabase
          .from('events')
          .select(EVENT_COLUMNS)
          .order('event_date', { ascending: false })
          .limit(limit)) as Result<EventRow[]>,
      ) ?? []
    );
  }

  /** Active events whose date is on or before `lastDate` (YYYY-MM-DD). */
  async activeOnOrBefore(lastDate: string, limit: number): Promise<string[]> {
    const rows =
      unwrap(
        (await this.supabase
          .from('events')
          .select('id')
          .eq('status', 'active')
          .lte('event_date', lastDate)
          .order('event_date', { ascending: true })
          .limit(limit)) as Result<{ id: string }[]>,
      ) ?? [];
    return rows.map((r) => r.id);
  }

  async close(id: string, actorType: 'user' | 'cron'): Promise<boolean> {
    const closed = unwrap(
      (await this.supabase.rpc('close_event', {
        p_event_id: id,
        p_actor_type: actorType,
      })) as Result<boolean>,
    );
    return closed === true;
  }

  /** Cash refunds owed, or -1 if it couldn't be cancelled. */
  async cancel(
    id: string,
    reason: string,
    actorType: 'user' | 'admin',
  ): Promise<number> {
    const owed = unwrap(
      (await this.supabase.rpc('cancel_event', {
        p_event_id: id,
        p_reason: reason,
        p_actor_type: actorType,
      })) as Result<number>,
    );
    return Number(owed ?? -1);
  }

  async recordPayout(
    id: string,
    amount: number,
    reference: string,
    staffId: string,
  ): Promise<boolean> {
    const recorded = unwrap(
      (await this.supabase.rpc('record_event_payout', {
        p_event_id: id,
        p_amount: amount,
        p_reference: reference,
        p_staff_id: staffId,
      })) as Result<boolean>,
    );
    return recorded === true;
  }

  // ---------------------------------------------------------------- cash

  async createCashGift(row: {
    event_id: string;
    guest_name: string;
    guest_email: string;
    guest_phone: string | null;
    message: string | null;
    show_on_wall: boolean;
    show_amount: boolean;
    amount: number;
    service_fee: number;
    total_amount: number;
    paystack_reference: string;
  }): Promise<CashGiftRow> {
    const created = unwrap(
      (await this.supabase
        .from('event_cash_gifts')
        .insert({ ...row, status: 'pending' })
        .select(GIFT_COLUMNS)
        .single()) as Result<CashGiftRow>,
    );
    if (!created) throw new Error('event_cash_gifts insert returned no row');
    return created;
  }

  async markCashGiftFailed(id: string): Promise<void> {
    const { error } = await this.supabase
      .from('event_cash_gifts')
      .update({ status: 'failed' })
      .eq('id', id)
      .eq('status', 'pending');
    if (error) throw error;
  }

  async cashGiftStatus(
    eventId: string,
    reference: string,
  ): Promise<CashGiftStatus | null> {
    const row = unwrap(
      (await this.supabase
        .from('event_cash_gifts')
        .select('status')
        .eq('event_id', eventId)
        .eq('paystack_reference', reference)
        .maybeSingle()) as Result<{ status: CashGiftStatus }>,
    );
    return row?.status ?? null;
  }

  /** Confirmed cash gifts, newest first. `wallOnly` = the guest allowed their name on the wall. */
  async confirmedCashGifts(
    eventId: string,
    limit: number,
    wallOnly: boolean,
  ): Promise<CashGiftRow[]> {
    let query = this.supabase
      .from('event_cash_gifts')
      .select(GIFT_COLUMNS)
      .eq('event_id', eventId)
      .eq('status', 'confirmed');
    if (wallOnly) query = query.eq('show_on_wall', true);
    return (
      unwrap(
        (await query
          .order('confirmed_at', { ascending: false })
          .limit(limit)) as Result<CashGiftRow[]>,
      ) ?? []
    );
  }

  async markCashThanked(eventId: string, giftId: string): Promise<boolean> {
    const rows = unwrap(
      (await this.supabase
        .from('event_cash_gifts')
        .update({ thanked_at: new Date().toISOString() })
        .eq('id', giftId)
        .eq('event_id', eventId)
        .eq('status', 'confirmed')
        .select('id')) as Result<{ id: string }[]>,
    );
    return (rows?.length ?? 0) === 1;
  }

  async confirmCashGift(
    reference: string,
    amount: number,
    transactionId: string,
    capKobo: number,
  ): Promise<ConfirmCashResult> {
    const result = unwrap(
      (await this.supabase.rpc('confirm_event_cash_gift', {
        p_reference: reference,
        p_amount: amount,
        p_transaction_id: transactionId,
        p_cap: capKobo,
      })) as Result<string>,
    );
    if (
      result !== 'confirmed' &&
      result !== 'late' &&
      result !== 'over_cap' &&
      result !== 'already_applied'
    ) {
      throw new Error(`confirm_event_cash_gift returned ${String(result)}`);
    }
    return result;
  }

  // ------------------------------------------------------------- refunds

  async refundsOwed(limit: number): Promise<string[]> {
    const rows =
      unwrap(
        (await this.supabase
          .from('event_cash_gifts')
          .select('id')
          .eq('refund_status', 'pending')
          .order('refund_requested_at', { ascending: true })
          .limit(limit)) as Result<{ id: string }[]>,
      ) ?? [];
    return rows.map((r) => r.id);
  }

  /** pending -> submitting in the UPDATE itself: one worker per refund. */
  async claimRefund(id: string): Promise<CashGiftRow | null> {
    const rows = unwrap(
      (await this.supabase
        .from('event_cash_gifts')
        .update({ refund_status: 'submitting' })
        .eq('id', id)
        .eq('refund_status', 'pending')
        .select(GIFT_COLUMNS)) as Result<CashGiftRow[]>,
    );
    return rows?.[0] ?? null;
  }

  async refundSubmitted(id: string, paystackRefundId: string): Promise<void> {
    const { error } = await this.supabase
      .from('event_cash_gifts')
      .update({
        refund_status: 'processing',
        paystack_refund_id: paystackRefundId,
        refund_error: null,
      })
      .eq('id', id)
      .eq('refund_status', 'submitting');
    if (error) throw error;
  }

  async refundNotSent(
    id: string,
    attempts: number,
    error: string,
    giveUp: boolean,
  ): Promise<void> {
    const { error: dbError } = await this.supabase
      .from('event_cash_gifts')
      .update({
        refund_status: giveUp ? 'failed' : 'pending',
        refund_attempts: attempts,
        refund_error: error.slice(0, 300),
      })
      .eq('id', id)
      .eq('refund_status', 'submitting');
    if (dbError) throw dbError;
  }

  /** A refund.* webhook for a cash gift, matched on the gift's own reference. */
  async applyRefundProgress(
    reference: string,
    progress: 'completed' | 'failed' | 'needs_attention',
  ): Promise<CashGiftRow | null> {
    const existing = unwrap(
      (await this.supabase
        .from('event_cash_gifts')
        .select(GIFT_COLUMNS)
        .eq('paystack_reference', reference)
        .in('refund_status', ['submitting', 'processing', 'failed'])
        .maybeSingle()) as Result<CashGiftRow>,
    );
    if (!existing) return null;

    const changes: Record<string, unknown> =
      progress === 'completed'
        ? {
            refund_status: 'completed',
            refunded_at: new Date().toISOString(),
            refund_error: null,
            status: 'refunded',
          }
        : progress === 'failed'
          ? {
              refund_status: 'failed',
              refund_error:
                'Paystack could not complete the refund; the money went back to the SendEbun balance. Refund this guest another way.',
            }
          : {
              refund_error:
                "Paystack needs this guest's bank details to finish the refund. Complete it in the Paystack dashboard.",
            };

    return unwrap(
      (await this.supabase
        .from('event_cash_gifts')
        .update(changes)
        .eq('id', existing.id)
        .select(GIFT_COLUMNS)
        .single()) as Result<CashGiftRow>,
    );
  }
}
