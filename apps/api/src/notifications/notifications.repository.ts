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

/** A failed send that still has attempts left, with everything needed to re-send it. */
export interface RetryableNotificationRow extends NotificationRow {
  recipient_phone: string | null;
  payload: { data?: Record<string, string>; revealUrl?: string } | null;
  retry_count: number;
  max_retries: number;
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

  /**
   * Failed sends that are due another attempt.
   *
   * The schema designed for exactly this: "Background job polls for
   * status=pending OR status=retrying where next_retry_at < now()".
   * `failed` is included too, because markFailed is what the live send
   * path writes on its first failure — without it, every notification
   * would get its initial attempt and no retry at all.
   *
   * A null next_retry_at means "never scheduled", which is true of a
   * first failure, so those are due immediately.
   */
  async findRetryable(limit: number): Promise<RetryableNotificationRow[]> {
    const response = (await this.supabase
      .from('notifications')
      .select()
      .in('status', [
        NotificationStatus.Failed,
        NotificationStatus.Retrying,
        NotificationStatus.Pending,
      ])
      .or(`next_retry_at.is.null,next_retry_at.lte.${new Date().toISOString()}`)
      .order('created_at', { ascending: true })
      .limit(limit)) as {
      data: RetryableNotificationRow[] | null;
      error: PostgrestError | null;
    };

    if (response.error) {
      throw response.error;
    }

    // max_retries is per-row in the schema (default 3), so the ceiling
    // is read from the row rather than assumed here.
    return (response.data ?? []).filter(
      (row) => row.retry_count < row.max_retries,
    );
  }

  /**
   * Records a failed attempt and when to try again. Kept separate from
   * markFailed, which is the live send path's "this attempt failed"
   * and deliberately says nothing about retrying.
   */
  async scheduleRetry(
    id: string,
    attempt: number,
    nextRetryAt: Date,
    errorMessage: string,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('notifications')
      .update({
        status: NotificationStatus.Retrying,
        retry_count: attempt,
        next_retry_at: nextRetryAt.toISOString(),
        error_message: errorMessage,
        failed_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (error) {
      throw error;
    }
  }

  /** Terminal give-up: attempts exhausted, no further retry scheduled. */
  async markExhausted(
    id: string,
    attempt: number,
    errorMessage: string,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('notifications')
      .update({
        status: NotificationStatus.Failed,
        retry_count: attempt,
        next_retry_at: null,
        error_message: errorMessage,
        failed_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (error) {
      throw error;
    }
  }
}
