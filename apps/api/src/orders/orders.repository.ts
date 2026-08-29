import { Inject, Injectable } from '@nestjs/common';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { OrderStatus } from '@ebun/types';
import { SUPABASE_CLIENT } from '../supabase/supabase.module';

/** Mirrors the schema's actor_type enum — kept local since only this
 * repository's RPC call needs it; not worth a shared package export
 * for one parameter type. */
export type OrderTransitionActorType =
  'user' | 'vendor' | 'system' | 'webhook' | 'admin' | 'cron';

export interface AttemptOrderTransitionParams {
  orderId: string;
  expectedStatus: OrderStatus;
  newStatus: OrderStatus;
  actorType: OrderTransitionActorType;
  actorId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface OrderRow {
  id: string;
  status: OrderStatus;
  [key: string]: unknown;
}

/**
 * Thin wrapper around attempt_order_transition() (see
 * supabase/migrations — attempt_order_transition.sql). Deliberately does
 * NOT validate whether the transition is legal — that's
 * OrderStateMachineService's job and must happen before this is called.
 * This class only owns the atomic write itself.
 */
@Injectable()
export class OrdersRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  /**
   * Returns the updated order row on success, or null if the compare-
   * and-swap failed — the order doesn't exist, or its status no longer
   * matches expectedStatus (a concurrent writer won the race). Null is
   * a normal, expected outcome to handle, not necessarily a bug.
   */
  async attemptTransition(
    params: AttemptOrderTransitionParams,
  ): Promise<OrderRow | null> {
    // Cast the response itself, not just the destructuring target —
    // without a generated Supabase `Database` type wired into
    // createClient() (no `supabase gen types typescript` step in the
    // build yet), .rpc()'s return type resolves to `any` all the way
    // through, and annotating only the destructured variables doesn't
    // change the assignment SOURCE's inferred type, so
    // @typescript-eslint/no-unsafe-assignment still fires. Casting the
    // awaited expression fixes that at the source. Once generated types
    // exist, this can simplify to createClient<Database>(...) at the
    // SupabaseModule level instead of casting at every call site.
    const response = (await this.supabase.rpc('attempt_order_transition', {
      p_order_id: params.orderId,
      p_expected_status: params.expectedStatus,
      p_new_status: params.newStatus,
      p_actor_type: params.actorType,
      p_actor_id: params.actorId ?? null,
      p_metadata: params.metadata ?? null,
    })) as { data: OrderRow | null; error: PostgrestError | null };

    if (response.error) {
      // Let this surface as-is for now — a global exception filter can
      // translate Postgres/PostgREST errors into HTTP responses once
      // one exists. Swallowing it here would hide real failures
      // (connection errors, bad enum values, etc.) behind a plain null.
      throw response.error;
    }

    return response.data ?? null;
  }
}
