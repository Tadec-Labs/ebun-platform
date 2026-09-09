import { Inject, Injectable } from '@nestjs/common';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { FulfillmentStatus, FulfillmentType } from '@ebun/types';
import { SUPABASE_CLIENT } from '../supabase/supabase.module';

export interface FulfillmentRow {
  id: string;
  order_id: string;
  fulfillment_type: FulfillmentType;
  status: FulfillmentStatus;
  [key: string]: unknown;
}

export interface CreateFulfillmentParams {
  orderId: string;
  fulfillmentType: FulfillmentType;
  status: FulfillmentStatus;
  vtuRequestId?: string;
  vtuPhoneNumber?: string;
}

export interface MarkVoucherIssuedParams {
  voucherCode: string;
  voucherValidUntil: string;
}

export interface MarkVtuCompleteParams {
  providerTransactionId: string;
}

/**
 * Thin wrapper around the gift_fulfillments table — one row per order
 * (order_id is UNIQUE in the schema), created once fulfillment actually
 * begins. Deliberately narrow, named methods per state transition
 * (markVoucherIssued, markVtuProcessing, markVtuComplete) rather than one
 * generic `update(orderId, patch)` — same reasoning as OrdersRepository
 * having a single attemptTransition() rather than an open update: each
 * method's name says exactly which columns it touches and why, so a
 * caller can't accidentally set voucher fields on a VTU row or vice
 * versa.
 *
 * NOT exported from FulfillmentModule — FulfillmentOrchestratorService
 * is the only public surface, same encapsulation boundary
 * OrdersRepository/OrdersService already establish.
 *
 * No idempotent "create-or-fetch-existing" handling here yet: a second
 * create() for the same order_id will throw on the table's UNIQUE
 * constraint. That's an honest failure, not a silent one — there's no
 * automatic retry/resume path calling this twice today (see
 * FulfillmentOrchestratorService's file header), so building
 * insert-or-fetch logic now would be speculative. A future retry/resume
 * mechanism should add that handling deliberately, not inherit it by
 * accident.
 */
@Injectable()
export class GiftFulfillmentsRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async create(params: CreateFulfillmentParams): Promise<FulfillmentRow> {
    const response = (await this.supabase
      .from('gift_fulfillments')
      .insert({
        order_id: params.orderId,
        fulfillment_type: params.fulfillmentType,
        status: params.status,
        vtu_request_id: params.vtuRequestId ?? null,
        vtu_phone_number: params.vtuPhoneNumber ?? null,
      })
      .select()
      .single()) as {
      data: FulfillmentRow | null;
      error: PostgrestError | null;
    };

    if (response.error) {
      throw response.error;
    }
    if (!response.data) {
      throw new Error('gift_fulfillments insert returned no data');
    }

    return response.data;
  }

  /** digital_voucher path only. Sets voucher_issued_at to now() in the same write as the code and validity, rather than in a separate round-trip. */
  async markVoucherIssued(
    orderId: string,
    params: MarkVoucherIssuedParams,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('gift_fulfillments')
      .update({
        voucher_code: params.voucherCode,
        voucher_issued_at: new Date().toISOString(),
        voucher_valid_until: params.voucherValidUntil,
        status: FulfillmentStatus.VoucherGenerated,
      })
      .eq('order_id', orderId);

    if (error) {
      throw error;
    }
  }

  /** vtu path only. Marks the row as "about to call the provider" — a distinct, queryable moment from "row just created", useful for spotting a fulfillment stuck mid-call if the process dies during the outbound request. */
  async markVtuProcessing(orderId: string): Promise<void> {
    const { error } = await this.supabase
      .from('gift_fulfillments')
      .update({ status: FulfillmentStatus.VtuProcessing })
      .eq('order_id', orderId);

    if (error) {
      throw error;
    }
  }

  /** vtu path only. Called after the provider confirms the top-up succeeded. */
  async markVtuComplete(
    orderId: string,
    params: MarkVtuCompleteParams,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('gift_fulfillments')
      .update({
        vtu_transaction_id: params.providerTransactionId,
        vtu_completed_at: new Date().toISOString(),
        status: FulfillmentStatus.VtuComplete,
      })
      .eq('order_id', orderId);

    if (error) {
      throw error;
    }
  }
}
