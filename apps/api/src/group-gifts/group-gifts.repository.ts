import { Inject, Injectable } from '@nestjs/common';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/supabase.module';

export type GroupGiftStatus =
  'open' | 'funded' | 'triggered' | 'expired' | 'cancelled';

export type ContributionStatus =
  'pending' | 'confirmed' | 'late' | 'failed' | 'refunded';

export type RefundStatus =
  'pending' | 'submitting' | 'processing' | 'completed' | 'failed';

export interface GroupGiftRow {
  id: string;
  gift_template_id: string;
  organiser_id: string;
  /** As typed when the pot was started; null on pots from before 20261031090000. */
  organiser_name: string | null;
  recipient_name: string;
  recipient_phone: string;
  target_amount: number;
  amount_raised: number;
  contributor_count: number;
  status: GroupGiftStatus;
  deadline: string;
  token: string;
  organiser_token: string;
  reveal_theme: string;
  sender_message: string | null;
  linked_order_id: string | null;
  gift_value: number | null;
  delivery_fee: number;
  send_at: string | null;
  show_amounts: boolean;
  deadline_extended: boolean;
  funded_at: string | null;
  closed_at: string | null;
  close_reason: string | null;
  created_at: string;
}

export interface ContributionRow {
  id: string;
  group_gift_id: string;
  contributor_name: string;
  contributor_email: string | null;
  contributor_phone: string | null;
  amount: number;
  service_fee: number;
  total_amount: number;
  message: string | null;
  paystack_reference: string;
  status: ContributionStatus;
  confirmed_at: string | null;
  refund_status: RefundStatus | null;
  refund_amount: number | null;
  refund_attempts: number;
  refund_error: string | null;
  created_at: string;
}

export type ConfirmResult = 'confirmed' | 'funded' | 'late' | 'already_applied';

const POT_COLUMNS =
  'id, gift_template_id, organiser_id, organiser_name, recipient_name, recipient_phone, target_amount, amount_raised, contributor_count, status, deadline, token, organiser_token, reveal_theme, sender_message, linked_order_id, gift_value, delivery_fee, send_at, show_amounts, deadline_extended, funded_at, closed_at, close_reason, created_at';

const CONTRIBUTION_COLUMNS =
  'id, group_gift_id, contributor_name, contributor_email, contributor_phone, amount, service_fee, total_amount, message, paystack_reference, status, confirmed_at, refund_status, refund_amount, refund_attempts, refund_error, created_at';

type Result<T> = { data: T | null; error: PostgrestError | null };

function unwrap<T>(response: Result<T>): T | null {
  if (response.error) throw response.error;
  return response.data ?? null;
}

/**
 * Every query group gifting makes. The money-touching writes — counting
 * a payment, funding the pot, closing it, switching the gift — are SQL
 * functions that lock the pot (20261025100000_group_gifting.sql).
 * Everything here is either a read or a guarded single-row update.
 */
@Injectable()
export class GroupGiftsRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async create(row: {
    gift_template_id: string;
    organiser_id: string;
    organiser_name: string;
    recipient_name: string;
    recipient_phone: string;
    target_amount: number;
    gift_value: number;
    delivery_fee: number;
    deadline: string;
    send_at: string | null;
    sender_message: string | null;
    show_amounts: boolean;
  }): Promise<GroupGiftRow> {
    const created = unwrap(
      (await this.supabase
        .from('group_gifts')
        .insert(row)
        .select(POT_COLUMNS)
        .single()) as Result<GroupGiftRow>,
    );
    if (!created) throw new Error('group_gifts insert returned no row');
    return created;
  }

  async findByToken(token: string): Promise<GroupGiftRow | null> {
    return unwrap(
      (await this.supabase
        .from('group_gifts')
        .select(POT_COLUMNS)
        .eq('token', token)
        .maybeSingle()) as Result<GroupGiftRow>,
    );
  }

  async findByOrganiserToken(token: string): Promise<GroupGiftRow | null> {
    return unwrap(
      (await this.supabase
        .from('group_gifts')
        .select(POT_COLUMNS)
        .eq('organiser_token', token)
        .maybeSingle()) as Result<GroupGiftRow>,
    );
  }

  async findById(id: string): Promise<GroupGiftRow | null> {
    return unwrap(
      (await this.supabase
        .from('group_gifts')
        .select(POT_COLUMNS)
        .eq('id', id)
        .maybeSingle()) as Result<GroupGiftRow>,
    );
  }

  /** Confirmed and late shares, oldest first. Pending checkouts aren't anyone's contribution yet. */
  async contributions(groupGiftId: string): Promise<ContributionRow[]> {
    return (
      unwrap(
        (await this.supabase
          .from('group_gift_contributions')
          .select(CONTRIBUTION_COLUMNS)
          .eq('group_gift_id', groupGiftId)
          .in('status', ['confirmed', 'late', 'refunded'])
          .order('confirmed_at', { ascending: true })
          .order('id', { ascending: true })) as Result<ContributionRow[]>,
      ) ?? []
    );
  }

  async createContribution(row: {
    group_gift_id: string;
    contributor_name: string;
    contributor_email: string;
    contributor_phone: string | null;
    amount: number;
    service_fee: number;
    total_amount: number;
    message: string | null;
    paystack_reference: string;
  }): Promise<ContributionRow> {
    const created = unwrap(
      (await this.supabase
        .from('group_gift_contributions')
        .insert({ ...row, status: 'pending' })
        .select(CONTRIBUTION_COLUMNS)
        .single()) as Result<ContributionRow>,
    );
    if (!created) throw new Error('contribution insert returned no row');
    return created;
  }

  /** One checkout's status, scoped to its own pot. */
  async contributionStatus(
    groupGiftId: string,
    reference: string,
  ): Promise<ContributionStatus | null> {
    const row = unwrap(
      (await this.supabase
        .from('group_gift_contributions')
        .select('status')
        .eq('group_gift_id', groupGiftId)
        .eq('paystack_reference', reference)
        .maybeSingle()) as Result<{ status: ContributionStatus }>,
    );
    return row?.status ?? null;
  }

  /** A checkout Paystack never started: it can never be paid, so it's marked failed. */
  async markContributionFailed(id: string): Promise<void> {
    const { error } = await this.supabase
      .from('group_gift_contributions')
      .update({ status: 'failed' })
      .eq('id', id)
      .eq('status', 'pending');
    if (error) throw error;
  }

  async confirmContribution(
    reference: string,
    amount: number,
    transactionId: string,
  ): Promise<ConfirmResult> {
    const result = unwrap(
      (await this.supabase.rpc('confirm_group_contribution', {
        p_reference: reference,
        p_amount: amount,
        p_transaction_id: transactionId,
      })) as Result<string>,
    );
    if (
      result !== 'confirmed' &&
      result !== 'funded' &&
      result !== 'late' &&
      result !== 'already_applied'
    ) {
      throw new Error(`confirm_group_contribution returned ${String(result)}`);
    }
    return result;
  }

  /** Returns refunds owed, or -1 when the pot was no longer open. */
  async close(
    groupGiftId: string,
    status: 'cancelled' | 'expired',
    reason: string,
    actorType: 'user' | 'cron',
  ): Promise<number> {
    const owed = unwrap(
      (await this.supabase.rpc('close_group_gift', {
        p_group_gift_id: groupGiftId,
        p_status: status,
        p_reason: reason,
        p_actor_type: actorType,
      })) as Result<number>,
    );
    return Number(owed ?? -1);
  }

  async switchGift(
    groupGiftId: string,
    giftTemplateId: string,
    giftValue: number,
    deliveryFee: number,
  ): Promise<string> {
    const orderId = unwrap(
      (await this.supabase.rpc('switch_group_gift', {
        p_group_gift_id: groupGiftId,
        p_gift_template_id: giftTemplateId,
        p_gift_value: giftValue,
        p_delivery_fee: deliveryFee,
      })) as Result<string>,
    );
    if (!orderId) throw new Error('switch_group_gift returned no order');
    return orderId;
  }

  /**
   * One extension, guarded in the UPDATE itself: a second tap, or two
   * tabs, finds deadline_extended already true and changes nothing.
   */
  async extend(groupGiftId: string, deadline: string): Promise<boolean> {
    const rows = unwrap(
      (await this.supabase
        .from('group_gifts')
        .update({ deadline, deadline_extended: true })
        .eq('id', groupGiftId)
        .eq('status', 'open')
        .eq('deadline_extended', false)
        .select('id')) as Result<{ id: string }[]>,
    );
    return (rows?.length ?? 0) === 1;
  }

  /** Open pots whose decision window has run out. */
  async overdue(before: Date, limit: number): Promise<string[]> {
    const rows =
      unwrap(
        (await this.supabase
          .from('group_gifts')
          .select('id')
          .eq('status', 'open')
          .lt('deadline', before.toISOString())
          .order('deadline', { ascending: true })
          .limit(limit)) as Result<{ id: string }[]>,
      ) ?? [];
    return rows.map((r) => r.id);
  }

  /**
   * Claims one owed refund for this worker: pending -> submitting, in the
   * UPDATE's own WHERE. Two instances racing for the same row can't both
   * send it to Paystack.
   */
  async claimRefund(contributionId: string): Promise<ContributionRow | null> {
    const rows = unwrap(
      (await this.supabase
        .from('group_gift_contributions')
        .update({ refund_status: 'submitting' })
        .eq('id', contributionId)
        .eq('refund_status', 'pending')
        .select(CONTRIBUTION_COLUMNS)) as Result<ContributionRow[]>,
    );
    return rows?.[0] ?? null;
  }

  async refundsOwed(limit: number): Promise<string[]> {
    const rows =
      unwrap(
        (await this.supabase
          .from('group_gift_contributions')
          .select('id')
          .eq('refund_status', 'pending')
          .order('refund_requested_at', { ascending: true })
          .limit(limit)) as Result<{ id: string }[]>,
      ) ?? [];
    return rows.map((r) => r.id);
  }

  async refundSubmitted(id: string, paystackRefundId: string): Promise<void> {
    const { error } = await this.supabase
      .from('group_gift_contributions')
      .update({
        refund_status: 'processing',
        paystack_refund_id: paystackRefundId,
        refund_error: null,
      })
      .eq('id', id)
      .eq('refund_status', 'submitting');
    if (error) throw error;
  }

  /** Back in the queue after a network failure, or failed for good. */
  async refundNotSent(
    id: string,
    attempts: number,
    error: string,
    giveUp: boolean,
  ): Promise<void> {
    const { error: dbError } = await this.supabase
      .from('group_gift_contributions')
      .update({
        refund_status: giveUp ? 'failed' : 'pending',
        refund_attempts: attempts,
        refund_error: error.slice(0, 300),
      })
      .eq('id', id)
      .eq('refund_status', 'submitting');
    if (dbError) throw dbError;
  }

  /**
   * A refund.* webhook for a contribution. Matched on the contribution's
   * own Paystack reference. A full refund (the pot never became a gift,
   * or the payment came late) marks the share refunded; a partial one (a
   * switch's surplus) leaves it confirmed.
   */
  async applyRefundProgress(
    reference: string,
    progress: 'completed' | 'failed' | 'needs_attention',
  ): Promise<ContributionRow | null> {
    const existing = unwrap(
      (await this.supabase
        .from('group_gift_contributions')
        .select(CONTRIBUTION_COLUMNS)
        .eq('paystack_reference', reference)
        .in('refund_status', ['submitting', 'processing', 'failed'])
        .maybeSingle()) as Result<ContributionRow>,
    );
    if (!existing) return null;

    const now = new Date().toISOString();
    const changes: Record<string, unknown> =
      progress === 'completed'
        ? {
            refund_status: 'completed',
            refunded_at: now,
            refund_error: null,
            ...(existing.refund_amount === existing.total_amount
              ? { status: 'refunded' }
              : {}),
          }
        : progress === 'failed'
          ? {
              refund_status: 'failed',
              refund_error:
                'Paystack could not complete the refund; the money went back to the SendEbun balance. Refund this person another way.',
            }
          : {
              refund_error:
                "Paystack needs this person's bank details to finish the refund. Complete it in the Paystack dashboard.",
            };

    const updated = unwrap(
      (await this.supabase
        .from('group_gift_contributions')
        .update(changes)
        .eq('id', existing.id)
        .select(CONTRIBUTION_COLUMNS)
        .single()) as Result<ContributionRow>,
    );
    return updated;
  }

  /** The pot a contribution checkout belongs to. */
  async findByContributionReference(
    reference: string,
  ): Promise<GroupGiftRow | null> {
    const row = unwrap(
      (await this.supabase
        .from('group_gift_contributions')
        .select('group_gift_id')
        .eq('paystack_reference', reference)
        .maybeSingle()) as Result<{ group_gift_id: string }>,
    );
    return row ? this.findById(row.group_gift_id) : null;
  }

  /** Paid group-gift orders that haven't started fulfilment — the safety net's work list. */
  async ordersReadyToFulfil(olderThan: Date, limit: number): Promise<string[]> {
    const rows =
      unwrap(
        (await this.supabase
          .from('orders')
          .select('id')
          .not('group_gift_id', 'is', null)
          .eq('status', 'paid')
          .lt('updated_at', olderThan.toISOString())
          .order('updated_at', { ascending: true })
          .limit(limit)) as Result<{ id: string }[]>,
      ) ?? [];
    return rows.map((r) => r.id);
  }

  /** The order's reveal token, for the organiser to share once the gift exists. */
  async orderRevealToken(orderId: string): Promise<string | null> {
    const row = unwrap(
      (await this.supabase
        .from('orders')
        .select('reveal_token')
        .eq('id', orderId)
        .maybeSingle()) as Result<{ reveal_token: string }>,
    );
    return row?.reveal_token ?? null;
  }
}
