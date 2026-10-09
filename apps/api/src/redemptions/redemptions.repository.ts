import { Inject, Injectable } from '@nestjs/common';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { OrderStatus, RedemptionStatus } from '@ebun/types';
import { SUPABASE_CLIENT } from '../supabase/supabase.module';

export interface RedemptionRow {
  id: string;
  order_id: string;
  redemption_number: string;
  redemption_token: string;
  fallback_code: string;
  status: RedemptionStatus;
  [key: string]: unknown;
}

/**
 * One redemption plus just enough of its order and gift for an ops
 * screen to show WHAT is being collected and FOR WHOM before anyone
 * confirms it — PostgREST embedding rather than three round trips.
 *
 * Embedded relations are typed nullable because PostgREST returns null
 * for a missing one rather than failing; in practice order_id is NOT
 * NULL and orders.gift_template_id is NOT NULL, so null here would mean
 * a broken row, which the service surfaces rather than guesses past.
 */
export interface RedemptionLookupRow extends RedemptionRow {
  expires_at: string;
  completed_at: string | null;
  orders: {
    id: string;
    order_number: string | null;
    recipient_name: string;
    status: OrderStatus;
    gift_templates: { name: string } | null;
  } | null;
}

/**
 * Thin wrapper around the redemptions table and its atomic
 * attempt_redemption() RPC. NOT exported from RedemptionsModule —
 * RedemptionsService is the sole public surface, same boundary as
 * every other repository in this codebase.
 *
 * UNLIKE GiftFulfillmentsRepository's deliberately-non-idempotent
 * create(): creating a pending redemption IS plausibly invoked more
 * than once in completely normal use — a recipient double-tapping
 * "accept", a flaky mobile connection retrying the POST, or reloading a
 * page that re-fires the request. There's no automatic-retry-vs-real-bug
 * ambiguity to worry about here the way there was for internal
 * orchestration retries; treating a second call as "fetch what's
 * already there" is simply correct. Hence createPendingOrFetch below,
 * rather than a bare create() that throws on the second call.
 */
@Injectable()
export class RedemptionsRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async createPendingOrFetch(
    orderId: string,
    expiresAt: string,
  ): Promise<RedemptionRow> {
    const insertResponse = (await this.supabase
      .from('redemptions')
      .insert({
        order_id: orderId,
        status: RedemptionStatus.Pending,
        expires_at: expiresAt,
      })
      .select()
      .single()) as {
      data: RedemptionRow | null;
      error: PostgrestError | null;
    };

    if (!insertResponse.error && insertResponse.data) {
      return insertResponse.data;
    }

    if (insertResponse.error) {
      if (insertResponse.error.code !== '23505') {
        throw insertResponse.error;
      }
    } else {
      // No error, but also no data — an empty response the Supabase
      // client shouldn't normally produce. Thrown as a real Error
      // rather than falling through, since insertResponse.error is
      // null here and re-throwing it would throw `null`, not an
      // inspectable error.
      throw new Error(
        `redemptions insert for order ${orderId} returned neither data nor an error`,
      );
    }

    // order_id already has a redemption row (UNIQUE(order_id)) — fetch
    // and return the existing one rather than erroring.
    const existing = (await this.supabase
      .from('redemptions')
      .select()
      .eq('order_id', orderId)
      .single()) as {
      data: RedemptionRow | null;
      error: PostgrestError | null;
    };

    if (existing.error) {
      throw existing.error;
    }
    if (!existing.data) {
      // Shouldn't happen — the 23505 we just caught proves a row exists.
      // Thrown rather than silently returning something wrong.
      throw new Error(
        `redemptions row for order ${orderId} raced out of existence between insert conflict and fetch`,
      );
    }

    return existing.data;
  }

  /**
   * Read-only — unlike createPendingOrFetch, never creates a row.
   * `.maybeSingle()` rather than `.single()`: zero rows (no redemption
   * created for this order yet) is an expected, non-error outcome here,
   * not a fetch-after-insert race to treat as a bug.
   */
  async findByOrderId(orderId: string): Promise<RedemptionRow | null> {
    const response = (await this.supabase
      .from('redemptions')
      .select()
      .eq('order_id', orderId)
      .maybeSingle()) as {
      data: RedemptionRow | null;
      error: PostgrestError | null;
    };

    if (response.error) {
      throw response.error;
    }
    return response.data;
  }

  /**
   * Read-only lookup by the human-typed code, for ops redemption.
   * fallback_code is UNIQUE in the schema, so maybeSingle() is exact:
   * zero rows means no such code, which is an ordinary answer here
   * (mistyped, or a code from some other system), not an error.
   *
   * redemption_token IS selected — the ops flow needs it to call
   * attempt_redemption() — but it must never leave the service layer;
   * see RedemptionsService.lookupByFallbackCode.
   */
  async findByFallbackCode(code: string): Promise<RedemptionLookupRow | null> {
    const response = (await this.supabase
      .from('redemptions')
      .select(
        'id, order_id, redemption_number, redemption_token, fallback_code, ' +
          'status, expires_at, completed_at, ' +
          'orders(id, order_number, recipient_name, status, gift_templates(name))',
      )
      .eq('fallback_code', code)
      .maybeSingle()) as {
      data: RedemptionLookupRow | null;
      error: PostgrestError | null;
    };

    if (response.error) {
      throw response.error;
    }
    return response.data;
  }

  /**
   * Wraps the DB's own attempt_redemption() function — per its schema
   * comment, this is "the ONLY way to mark a redemption as completed".
   * Returns null if the token is unknown, already completed, or expired
   * — the RPC's own documented behaviour, not an error condition for
   * this method to interpret; RedemptionsService decides what null
   * means to its caller.
   */
  async attemptRedemption(params: {
    redemptionToken: string;
    vendorId: string | null;
    vendorConfirmedBy: string | null;
    ipAddress: string | null;
    userAgent: string | null;
  }): Promise<RedemptionRow | null> {
    const response = (await this.supabase.rpc('attempt_redemption', {
      p_redemption_token: params.redemptionToken,
      p_vendor_id: params.vendorId,
      p_vendor_confirmed_by: params.vendorConfirmedBy,
      p_ip_address: params.ipAddress,
      p_user_agent: params.userAgent,
    })) as { data: RedemptionRow | null; error: PostgrestError | null };

    if (response.error) {
      throw response.error;
    }

    return response.data;
  }

  /**
   * Expires redemptions whose window has passed, mirroring the
   * redemptions half of expire_unclaimed_gifts().
   *
   * Batched rather than row-by-row, unlike orders: redemptions have no
   * state machine and no audit contract of their own — their status is
   * guarded by attempt_redemption() for the one transition that
   * matters (completion), and expiry is bookkeeping on rows nobody can
   * complete any more. Returns the ids it changed so the caller can log
   * precisely what moved.
   */
  async expireOverdue(): Promise<string[]> {
    const response = (await this.supabase
      .from('redemptions')
      .update({
        status: RedemptionStatus.Expired,
        updated_at: new Date().toISOString(),
      })
      .in('status', [RedemptionStatus.Pending, RedemptionStatus.Initiated])
      .lt('expires_at', new Date().toISOString())
      .select('id')) as {
      data: { id: string }[] | null;
      error: PostgrestError | null;
    };

    if (response.error) {
      throw response.error;
    }
    return (response.data ?? []).map((row) => row.id);
  }
}
