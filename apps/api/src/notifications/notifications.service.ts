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
}
