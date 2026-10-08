import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/supabase.module';

export interface AuditEventInput {
  eventType: string;
  actorId: string | null;
  actorType: 'user' | 'vendor' | 'system' | 'webhook' | 'admin' | 'cron';
  resourceType: string;
  resourceId: string;
  previousState?: string | null;
  newState?: string | null;
  /** Never put secrets or bank details in here — field NAMES that changed, not their values. */
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Appends to the immutable audit_events log (schema: INSERT-only by
 * design — nothing here ever updates or deletes).
 *
 * A failed audit write is logged loudly with the full event rather than
 * thrown: by the time this runs the business change has already been
 * committed, and failing the request would tell the caller their
 * change didn't happen when it did. supabase-js has no cross-statement
 * transaction to make the two atomic, so the honest fallback is making
 * the failure impossible to miss and the event reconstructable from
 * the logs. (The orders state machine avoids this entirely by writing
 * its audit row inside the same DB function as the transition.)
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async record(event: AuditEventInput): Promise<void> {
    try {
      const response = (await this.supabase.from('audit_events').insert({
        event_type: event.eventType,
        actor_id: event.actorId,
        actor_type: event.actorType,
        resource_type: event.resourceType,
        resource_id: event.resourceId,
        previous_state: event.previousState ?? null,
        new_state: event.newState ?? null,
        metadata: event.metadata ?? null,
        ip_address: event.ipAddress ?? null,
        user_agent: event.userAgent ?? null,
      })) as { error: PostgrestError | null };

      if (response.error) {
        throw response.error;
      }
    } catch (error) {
      this.logger.error(
        `AUDIT WRITE FAILED — reconstruct from this log line: ${JSON.stringify(event)}`,
        error instanceof Error ? error.stack : JSON.stringify(error),
      );
    }
  }
}
