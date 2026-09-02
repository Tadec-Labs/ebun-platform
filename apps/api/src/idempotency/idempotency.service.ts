import { Inject, Injectable } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/supabase.module';

const UNIQUE_VIOLATION = '23505'; // Postgres SQLSTATE for a unique constraint violation

/**
  Generic wrapper around the `idempotency_keys` table. Not Paystack-specific — the schema's own comment on that table describes it as the dedup mechanism for "any webhook or external event"
  (Termii delivery receipts, VTU provider callbacks are named  explicitly), so this lives as its own small module rather than inside payments/.
 */

@Injectable()
export class IdempotencyService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  /**
   * Attempts to claim a key by inserting it. Returns true if this is the first time the key has been seen — the caller should proceed with processing. Returns false if the key already exists — the caller should treat this as a duplicate delivery and no-op.
   * Mirrors the schema's own documented workflow exactly: "1. Attempt
   * INSERT with the event ID as key. 2. If INSERT fails (unique
   * violation), event was already processed. 3. If INSERT succeeds,
   * process the event."
   */

  async claim(
    key: string,
    resourceType: string,
    resourceId?: string | null,
  ): Promise<boolean> {
    const { error } = await this.supabase.from('idempotency_keys').insert({
      key,
      resource_type: resourceType,
      resource_id: resourceId ?? null,
    });

    if (!error) {
      return true;
    }

    if (error.code === UNIQUE_VIOLATION) {
      return false; // already claimed — genuine duplicate, not a failure
    }

    throw error; // anything else is a real failure, not a dedup signal
  }
}
