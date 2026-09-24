import { Inject, Injectable } from '@nestjs/common';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { RedemptionStatus } from '@ebun/types';
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
}
