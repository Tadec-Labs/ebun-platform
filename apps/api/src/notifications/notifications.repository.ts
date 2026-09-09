import { Inject, Injectable } from '@nestjs/common';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { NotificationChannel, NotificationStatus } from '@ebun/types';
import { SUPABASE_CLIENT } from '../supabase/supabase.module';

export interface NotificationRow {
  id: string;
  order_id: string | null;
  status: NotificationStatus;
  idempotency_key: string | null;
  [key: string]: unknown;
}

export interface CreatePendingNotificationParams {
  orderId: string;
  recipientPhone: string;
  channel: NotificationChannel;
  notificationType: string;
  provider: string;
  templateName: string | null;
  payload: Record<string, unknown>;
  /** Maps onto notifications.idempotency_key (UNIQUE) — the schema's own documented purpose: "prevents duplicate sends on retry". */
  idempotencyKey: string;
}

/**
 * Thin wrapper around the notifications table. Unlike gift_fulfillments
 * (one row per order, enforced by a UNIQUE(order_id)), this table
 * intentionally allows multiple rows per order over time (retries,
 * multiple channels) — schema comment: "Tracks every outbound
 * communication". The per-notification-attempt uniqueness guard is
 * idempotency_key instead, scoped by caller (e.g.
 * `gift_reveal_link:${orderId}` — see NotificationsService).
 *
 * NOT exported from NotificationsModule — NotificationsService is the
 * only public surface, same encapsulation boundary as every other
 * repository in this codebase.
 */
@Injectable()
export class NotificationsRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  /**
   * Returns the created row, or the string 'ALREADY_SENT' if a row with
   * this idempotencyKey already exists (a real 23505 on the UNIQUE
   * constraint, not a pre-check-then-insert race) — the caller should
   * treat that as "nothing to do", not an error.
   */
  async createPending(
    params: CreatePendingNotificationParams,
  ): Promise<NotificationRow | 'ALREADY_SENT'> {
    const response = (await this.supabase
      .from('notifications')
      .insert({
        order_id: params.orderId,
        recipient_type: 'recipient',
        recipient_phone: params.recipientPhone,
        channel: params.channel,
        notification_type: params.notificationType,
        status: NotificationStatus.Pending,
        provider: params.provider,
        template_name: params.templateName,
        payload: params.payload,
        idempotency_key: params.idempotencyKey,
      })
      .select()
      .single()) as {
      data: NotificationRow | null;
      error: PostgrestError | null;
    };

    if (response.error) {
      if (response.error.code === '23505') {
        return 'ALREADY_SENT';
      }
      throw response.error;
    }
    if (!response.data) {
      throw new Error('notifications insert returned no data');
    }

    return response.data;
  }

  async markSent(id: string, providerMessageId: string): Promise<void> {
    const { error } = await this.supabase
      .from('notifications')
      .update({
        status: NotificationStatus.Sent,
        provider_message_id: providerMessageId,
        sent_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (error) {
      throw error;
    }
  }

  async markFailed(id: string, errorMessage: string): Promise<void> {
    const { error } = await this.supabase
      .from('notifications')
      .update({
        status: NotificationStatus.Failed,
        error_message: errorMessage,
        failed_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (error) {
      throw error;
    }
  }
}
