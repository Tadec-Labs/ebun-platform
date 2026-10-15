import { Inject, Injectable } from '@nestjs/common';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { OrderStatus, RedemptionStatus } from '@ebun/types';
import { SUPABASE_CLIENT } from '../supabase/supabase.module';

export type RefundStatus = 'pending' | 'processing' | 'completed' | 'failed';

export const REFUND_REASON_CATEGORIES = [
  'vendor_failure',
  'delivery_failure',
  'recipient_request',
  'duplicate_payment',
  'fraud',
  'admin_discretion',
  'other',
] as const;
export type RefundReasonCategory = (typeof REFUND_REASON_CATEGORIES)[number];

export interface RefundRow {
  id: string;
  order_id: string;
  amount: number;
  reason: string;
  reason_category: RefundReasonCategory | null;
  initiated_by_id: string | null;
  status: RefundStatus;
  paystack_refund_id: string | null;
  paystack_reference: string | null;
  processed_at: string | null;
  failed_at: string | null;
  failure_reason: string | null;
  notes: string | null;
  created_at: string;
}

export interface BegunRefund {
  refundId: string;
  amount: number;
  paystackReference: string | null;
  orderStatus: OrderStatus;
  /** The code status begin_order_refund voided, to restore if Paystack refuses. */
  voidedRedemptionStatus: RedemptionStatus | null;
}

/** Why begin_order_refund() refused, in the service's terms. */
export type RefundRefusal =
  | 'order_not_found'
  | 'not_refundable_status'
  | 'vendor_credited'
  | 'already_collected'
  | 'already_refunding';

export class RefundRefusedError extends Error {
  constructor(public readonly reason: RefundRefusal) {
    super(`Refund refused: ${reason}`);
    this.name = 'RefundRefusedError';
  }
}

const COLUMNS =
  'id, order_id, amount, reason, reason_category, initiated_by_id, status, paystack_refund_id, paystack_reference, processed_at, failed_at, failure_reason, notes, created_at';

type Result<T> = { data: T | null; error: PostgrestError | null };

/**
 * Every query refunds make. The two that must not race — starting a
 * refund and giving up on one — are SQL functions (see
 * 20261015120000_order_refunds.sql); the rest are single-row updates
 * guarded on status in the WHERE clause.
 */
@Injectable()
export class RefundsRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async begin(params: {
    orderId: string;
    refundableStatuses: OrderStatus[];
    reason: string;
    reasonCategory: RefundReasonCategory;
    initiatedBy: string | null;
  }): Promise<BegunRefund> {
    const response = (await this.supabase.rpc('begin_order_refund', {
      p_order_id: params.orderId,
      p_refundable_statuses: params.refundableStatuses,
      p_reason: params.reason,
      p_reason_category: params.reasonCategory,
      p_initiated_by: params.initiatedBy,
    })) as Result<
      {
        refund_id: string;
        amount: number | string;
        paystack_reference: string | null;
        order_status: OrderStatus;
        voided_redemption_status: RedemptionStatus | null;
      }[]
    >;

    if (response.error) {
      if (response.error.code === '23505') {
        throw new RefundRefusedError('already_refunding');
      }
      const message = response.error.message ?? '';
      for (const reason of [
        'order_not_found',
        'not_refundable_status',
        'vendor_credited',
        'already_collected',
      ] as const) {
        if (message.includes(`refund_${reason}`)) {
          throw new RefundRefusedError(reason);
        }
      }
      throw response.error;
    }
    const row = response.data?.[0];
    if (!row) throw new Error('begin_order_refund returned no row');
    return {
      refundId: row.refund_id,
      amount: Number(row.amount),
      paystackReference: row.paystack_reference,
      orderStatus: row.order_status,
      voidedRedemptionStatus: row.voided_redemption_status,
    };
  }

  /** Paystack refused or couldn't be reached: refund failed, the recipient's code given back. */
  async abandon(
    refundId: string,
    failureReason: string,
    restoreRedemption: RedemptionStatus | null,
  ): Promise<void> {
    const { error } = await this.supabase.rpc('abandon_order_refund', {
      p_refund_id: refundId,
      p_failure_reason: failureReason,
      p_restore_redemption: restoreRedemption,
    });
    if (error) throw error;
  }

  /** Paystack accepted it; webhooks report the rest. */
  async markSubmitted(refundId: string, paystackRefundId: string) {
    return this.update(refundId, ['pending'], {
      status: 'processing',
      paystack_refund_id: paystackRefundId,
    });
  }

  /** Ops already refunded it in the Paystack dashboard; this records that. */
  async markRecordedManually(refundId: string) {
    return this.update(refundId, ['pending'], {
      status: 'completed',
      processed_at: new Date().toISOString(),
      notes: 'Refunded in the Paystack dashboard; recorded in SendEbun.',
    });
  }

  /**
   * Applies a refund.* webhook to the open refund for that transaction.
   * Null when there is none — a refund made in the dashboard and never
   * recorded here, or a redelivery of an event already applied.
   */
  async applyProgress(
    paystackReference: string,
    values: Partial<
      Pick<
        RefundRow,
        'status' | 'processed_at' | 'failed_at' | 'failure_reason'
      >
    >,
  ): Promise<RefundRow | null> {
    const response = (await this.supabase
      .from('refunds')
      .update(values)
      .eq('paystack_reference', paystackReference)
      .in('status', ['pending', 'processing'])
      .select(COLUMNS)
      .maybeSingle()) as Result<RefundRow>;
    if (response.error) throw response.error;
    return response.data ?? null;
  }

  /** What deciding "can this be refunded?" needs to know about an order. */
  async findOrder(orderId: string): Promise<{
    id: string;
    status: OrderStatus;
    total_amount: number;
    vendor_payout_amount: number | null;
    paystack_reference: string | null;
  } | null> {
    const response = (await this.supabase
      .from('orders')
      .select(
        'id, status, total_amount, vendor_payout_amount, paystack_reference',
      )
      .eq('id', orderId)
      .maybeSingle()) as Result<{
      id: string;
      status: OrderStatus;
      total_amount: number;
      vendor_payout_amount: number | null;
      paystack_reference: string | null;
    }>;
    if (response.error) throw response.error;
    return response.data ?? null;
  }

  async listForOrder(orderId: string): Promise<RefundRow[]> {
    const response = (await this.supabase
      .from('refunds')
      .select(COLUMNS)
      .eq('order_id', orderId)
      .order('created_at', { ascending: false })) as Result<RefundRow[]>;
    if (response.error) throw response.error;
    return response.data ?? [];
  }

  private async update(
    refundId: string,
    fromStatuses: RefundStatus[],
    values: Record<string, unknown>,
  ): Promise<RefundRow | null> {
    const response = (await this.supabase
      .from('refunds')
      .update(values)
      .eq('id', refundId)
      .in('status', fromStatuses)
      .select(COLUMNS)
      .maybeSingle()) as Result<RefundRow>;
    if (response.error) throw response.error;
    return response.data ?? null;
  }
}
