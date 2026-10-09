import { Inject, Injectable } from '@nestjs/common';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/supabase.module';

export interface AuditEventRow {
  id: string;
  event_type: string;
  actor_id: string | null;
  actor_type: 'user' | 'vendor' | 'system' | 'webhook' | 'admin' | 'cron';
  resource_type: string;
  resource_id: string;
  previous_state: string | null;
  new_state: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

/**
 * The read side of audit_events. Deliberately a separate class from
 * AuditService, which only ever appends: that service is injected into
 * almost every write path in the API, and giving it a read method would
 * put a "list everything that ever happened to this resource" query one
 * autocomplete away from code that has no business running it.
 *
 * Nothing here selects ip_address or user_agent. Those are retained for
 * fraud investigation, which is a deliberate act against the database,
 * not something that should render on an ops page every time someone
 * opens an order.
 */
@Injectable()
export class AuditEventsRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  /**
   * The full history of one resource, oldest first — a timeline reads
   * forwards, and these are capped low enough that paging it would be a
   * symptom of something else going wrong.
   */
  async findForResource(
    resourceType: string,
    resourceId: string,
    limit = 200,
  ): Promise<AuditEventRow[]> {
    const response = (await this.supabase
      .from('audit_events')
      .select(
        'id, event_type, actor_id, actor_type, resource_type, resource_id, previous_state, new_state, metadata, created_at',
      )
      .eq('resource_type', resourceType)
      .eq('resource_id', resourceId)
      .order('created_at', { ascending: true })
      .limit(limit)) as {
      data: AuditEventRow[] | null;
      error: PostgrestError | null;
    };

    if (response.error) {
      throw response.error;
    }
    return response.data ?? [];
  }
}
