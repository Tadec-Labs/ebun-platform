import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationChannel } from '@ebun/types';
import { OrderRow } from '../orders/orders.repository';
import { OrdersService } from '../orders/orders.service';
import { TermiiWhatsappClientService } from '../termii/termii-whatsapp-client.service';
import { NotificationsRepository } from './notifications.repository';

const GIFT_REVEAL_LINK = 'GIFT_REVEAL_LINK';

/**
 * Only public surface of NotificationsModule — NotificationsRepository
 * stays internal, same boundary as every other module here.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly repository: NotificationsRepository,
    private readonly ordersService: OrdersService,
    private readonly termii: TermiiWhatsappClientService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Sends the gift-reveal WhatsApp message once an order is ready
   * (voucher_issued / ready_for_redemption). Deliberately does NOT
   * throw on failure — see the doc comment on this method's only
   * caller (FulfillmentOrchestratorService) for why a notification
   * failure must not be conflated with a fulfillment failure: the gift
   * itself is genuinely ready by the time this runs, so failing loudly
   * here would incorrectly imply the whole order is broken. Failure is
   * still fully recorded (notifications.status = 'failed',
   * error_message set) — silent to the caller, not silent to the data.
   */
  async sendGiftRevealLink(order: OrderRow): Promise<void> {
    if (
      order.scheduled_send_at &&
      new Date(order.scheduled_send_at) > new Date()
    ) {
      // Deliberately not sent now, and nothing schedules it for later —
      // no cron/scheduler exists yet (no @nestjs/schedule dependency in
      // apps/api today). A scheduled gift's fulfillment still completes
      // on time (voucher/VTU work isn't gated on scheduled_send_at, only
      // the recipient-visible notification is), but the WhatsApp send
      // itself needs a future poller for "orders past their
      // scheduled_send_at with no notification sent yet". Flagged, not
      // solved, same as every other cron-shaped gap in this codebase so
      // far.
      this.logger.log(
        `Order ${order.id}: scheduled_send_at is in the future — skipping WhatsApp send for now (needs a future scheduler to pick this up).`,
      );
      return;
    }

    const webAppBaseUrl = this.config.getOrThrow<string>('WEB_APP_BASE_URL');
    const revealUrl = `${webAppBaseUrl}/reveal/${order.reveal_token}`;

    // PROVISIONAL — see TermiiWhatsappClientService's header. Positional
    // keys ("1", "2") matching Termii's own documented example, but
    // which position means what is fixed by whichever WhatsApp template
    // actually gets approved on the Termii dashboard, which doesn't
    // exist yet. This mapping (1=recipient name, 2=reveal link) is a
    // reasonable guess for a template body like "Hi {{1}}, you've got a
    // gift! Open it here: {{2}}" — but if the approved template ends up
    // shaped differently (e.g. the link as a URL BUTTON component
    // rather than inline body text), this needs to change to match.
    // Confirm against the real template before relying on this in
    // production.
    const templateData: Record<string, string> = {
      '1': order.recipient_name,
      '2': revealUrl,
    };

    const templateId = this.config.get<string>('TERMII_WHATSAPP_TEMPLATE_ID');
    const idempotencyKey = `gift_reveal_link:${order.id}`;

    const created = await this.repository.createPending({
      orderId: order.id,
      recipientPhone: order.recipient_phone,
      channel: NotificationChannel.Whatsapp,
      notificationType: GIFT_REVEAL_LINK,
      provider: 'termii',
      templateName: templateId ?? null,
      payload: { data: templateData, revealUrl },
      idempotencyKey,
    });

    if (created === 'ALREADY_SENT') {
      this.logger.warn(
        `Order ${order.id}: a GIFT_REVEAL_LINK notification already exists (idempotencyKey=${idempotencyKey}) — not sending again.`,
      );
      return;
    }

    try {
      const result = await this.termii.sendTemplateMessage({
        phoneNumber: order.recipient_phone,
        data: templateData,
      });

      await this.repository.markSent(created.id, result.providerMessageId);
      await this.ordersService.recordRevealSent(order.id, revealUrl);

      this.logger.log(`Order ${order.id}: gift reveal link sent via WhatsApp`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.repository.markFailed(created.id, message);

      this.logger.warn(
        `Order ${order.id}: gift reveal WhatsApp send failed (order fulfillment itself is fine — only the notification failed): ${message}`,
      );
      // Not rethrown — see this method's doc comment.
    }
  }

  /**
   * Re-sends notifications whose first attempt failed, with the
   * exponential backoff the Brief specifies (3 attempts). Called by the
   * retry job, never by the live send path.
   *
   * Re-sends from the stored `payload` rather than rebuilding it from
   * the order: the payload is what was actually composed at send time,
   * and a retry that quietly changes the message is not a retry. It is
   * also why payload is persisted at all — the schema calls it "full
   * message payload for audit/retry".
   *
   * Returns a per-row outcome rather than throwing, so one unsendable
   * notification can't stop the rest of the batch.
   */
  async retryFailedSends(limit = 25): Promise<{
    attempted: number;
    sent: number;
    rescheduled: number;
    exhausted: number;
  }> {
    const due = await this.repository.findRetryable(limit);
    let sent = 0;
    let rescheduled = 0;
    let exhausted = 0;

    for (const row of due) {
      const attempt = row.retry_count + 1;
      const templateData = row.payload?.data;
      const phone = row.recipient_phone;

      if (!phone || !templateData) {
        // Nothing to re-send from. Giving up loudly beats retrying an
        // empty message every five minutes until the attempts run out.
        await this.repository.markExhausted(
          row.id,
          attempt,
          'Notification cannot be retried: missing recipient phone or payload data.',
        );
        exhausted += 1;
        this.logger.error(
          `Notification ${row.id} (order ${row.order_id ?? 'unknown'}) cannot be retried — no phone or payload. Giving up.`,
        );
        continue;
      }

      try {
        const result = await this.termii.sendTemplateMessage({
          phoneNumber: phone,
          data: templateData,
        });
        await this.repository.markSent(row.id, result.providerMessageId);

        // The order only learns its link went out on a successful send,
        // which is also what keeps the scheduled-send sweep from
        // picking this order up again.
        if (row.order_id && row.payload?.revealUrl) {
          await this.ordersService.recordRevealSent(
            row.order_id,
            row.payload.revealUrl,
          );
        }

        sent += 1;
        this.logger.log(
          `Notification ${row.id} sent on retry ${attempt} of ${row.max_retries}.`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        if (attempt >= row.max_retries) {
          await this.repository.markExhausted(row.id, attempt, message);
          exhausted += 1;
          this.logger.error(
            `Notification ${row.id} (order ${row.order_id ?? 'unknown'}) failed on its final attempt (${attempt}/${row.max_retries}): ${message}. ` +
              `The recipient has NOT been told about their gift — the sender's copy-link fallback is the only remaining route.`,
          );
          continue;
        }

        await this.repository.scheduleRetry(
          row.id,
          attempt,
          nextRetryAt(attempt),
          message,
        );
        rescheduled += 1;
        this.logger.warn(
          `Notification ${row.id} failed attempt ${attempt}; retrying later: ${message}`,
        );
      }
    }

    return { attempted: due.length, sent, rescheduled, exhausted };
  }
}

/**
 * Exponential backoff: roughly 5 minutes, then 25, then 125. Spaced
 * this way because the failure being waited out is usually a provider
 * outage or a rate limit, where hammering every minute neither helps
 * nor is forgiven — and because a gift is not a password reset, so
 * minutes of delay cost nothing.
 */
function nextRetryAt(attempt: number): Date {
  const minutes = 5 ** attempt;
  return new Date(Date.now() + minutes * 60_000);
}
