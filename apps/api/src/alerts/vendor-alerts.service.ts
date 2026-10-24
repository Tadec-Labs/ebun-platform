import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailSenderService } from './email-sender.service';
import {
  VendorAlertsRepository,
  VendorContactRow,
} from './vendor-alerts.repository';

const DEFAULT_ACK_MINUTES = 30;

/**
 * Tells vendors about work by email as well as on their link, and tells
 * ops when a vendor goes quiet.
 *
 *   newDelivery / newPickup   the moment it happens, to vendors.email
 *   escalateOverdue (cron)    after VENDOR_ACK_MINUTES with no "Got it":
 *                             a reminder to the vendor, and an email to
 *                             OPS_ALERT_EMAIL naming both their numbers
 *
 * Never throws to its caller. An alert is a second channel; the booking
 * or delivery it is about has already succeeded, and a mail outage must
 * not turn that into an error page for a recipient.
 *
 * The vendor's private link is deliberately NOT in any email: it is a
 * credential, and email passes through more hands than WhatsApp. The
 * email carries enough to act on by itself (who, what, where, when).
 */
@Injectable()
export class VendorAlertsService {
  private readonly logger = new Logger(VendorAlertsService.name);

  constructor(
    private readonly repository: VendorAlertsRepository,
    private readonly email: EmailSenderService,
    private readonly config: ConfigService,
  ) {}

  /** A doorstep delivery was just given to this vendor. */
  async newDelivery(orderId: string, vendorId: string): Promise<void> {
    await this.safely(`new delivery ${orderId}`, async () => {
      if (!this.email.isConfigured()) return;
      const [vendor, order] = await Promise.all([
        this.repository.vendorContact(vendorId),
        this.repository.order(orderId),
      ]);
      if (!vendor?.email || !order) return;

      const gift = order.gift_templates?.name ?? 'a gift';
      const where = [order.delivery_address, order.delivery_zone]
        .filter(Boolean)
        .join(', ');
      await this.send({
        orderId,
        recipientType: 'vendor',
        to: vendor.email,
        notificationType: 'VENDOR_NEW_ORDER',
        // Once per vendor per order: a double tap on "Assign" can't send
        // two. (Reassigned away and back is rare; the escalation sweep
        // still catches it if they miss it.)
        idempotencyKey: `vendor-delivery:${orderId}:${vendorId}`,
        subject: `New SendEbun delivery: ${gift} (${order.order_number ?? 'order'})`,
        text: [
          `Hi ${vendor.business_name},`,
          '',
          `You have a new SendEbun delivery. It's paid for.`,
          '',
          `Gift: ${gift}`,
          `For: ${order.recipient_name}`,
          `Phone: ${order.delivery_phone ?? order.recipient_phone}`,
          `Address: ${where || '—'}`,
          order.delivery_note ? `Note: ${order.delivery_note}` : null,
          `Order: ${order.order_number ?? orderId}`,
          '',
          `Open your SendEbun link and tap "Got it", then "Out for delivery". At the door, the rider asks the recipient for their 4-digit delivery code — enter it under "Delivered" and you're credited.`,
          '',
          `Can't find your link? Reply to this email and we'll send it again.`,
        ]
          .filter((line) => line !== null)
          .join('\n'),
      });
    });
  }

  /** A recipient just booked a time to collect here. */
  async newPickup(
    orderId: string,
    vendorId: string,
    pickupAtIso: string,
  ): Promise<void> {
    await this.safely(`new pickup ${orderId}`, async () => {
      if (!this.email.isConfigured()) return;
      const [vendor, order] = await Promise.all([
        this.repository.vendorContact(vendorId),
        this.repository.order(orderId),
      ]);
      if (!vendor?.email || !order) return;

      const gift = order.gift_templates?.name ?? 'a gift';
      const firstName = order.recipient_name.trim().split(/\s+/)[0];
      const when = lagosTime(pickupAtIso);
      await this.send({
        orderId,
        recipientType: 'vendor',
        to: vendor.email,
        notificationType: 'VENDOR_NEW_ORDER',
        idempotencyKey: `vendor-pickup:${orderId}:${vendorId}:${pickupAtIso}`,
        subject: `${firstName} is collecting ${gift} — ${when}`,
        text: [
          `Hi ${vendor.business_name},`,
          '',
          `${firstName} is coming to collect a SendEbun gift. It's paid for.`,
          '',
          `Gift: ${gift}`,
          `When: ${when}`,
          `Order: ${order.order_number ?? orderId}`,
          '',
          `Open your SendEbun link and tap "Got it" under "Coming in" so they know it'll be ready. They'll show a code at the counter.`,
          '',
          `Can't find your link? Reply to this email and we'll send it again.`,
        ].join('\n'),
      });
    });
  }

  /**
   * A vendor asked to sell something new from their link. Tells ops so
   * the request doesn't sit unseen until someone opens /ops.
   */
  async vendorItemRequested(input: {
    vendorId: string;
    vendorName: string;
    giftTemplateId: string;
    giftName: string;
    inStorePrice: number;
    withPhoto: boolean;
  }): Promise<void> {
    await this.safely(`item request ${input.giftTemplateId}`, async () => {
      const opsEmail = this.opsEmail();
      if (!opsEmail || !this.email.isConfigured()) return;
      await this.send({
        orderId: null,
        recipientType: 'admin',
        to: opsEmail,
        notificationType: 'OPS_VENDOR_REQUEST',
        idempotencyKey: `ops-item-request:${input.giftTemplateId}`,
        subject: `${input.vendorName} wants to sell ${input.giftName} (${naira(input.inStorePrice)})`,
        text: [
          `${input.vendorName} asked to sell a new item from their SendEbun link.`,
          '',
          `Item: ${input.giftName}`,
          `Their shop price: ${naira(input.inStorePrice)}`,
          `Photo: ${input.withPhoto ? 'yes' : 'not yet'}`,
          '',
          `It's off sale until you approve it. Check the price against their counter, then approve:`,
          this.opsLink(input.vendorId),
        ].join('\n'),
      });
    });
  }

  /**
   * A vendor asked for a new price. The old price keeps selling until
   * ops approves, so a request nobody sees is a vendor selling at a price
   * they no longer charge.
   */
  async vendorPriceChangeRequested(input: {
    vendorId: string;
    vendorName: string;
    giftTemplateId: string;
    giftName: string;
    currentPrice: number;
    proposedPrice: number;
    proposedAt: string;
  }): Promise<void> {
    await this.safely(`price request ${input.giftTemplateId}`, async () => {
      const opsEmail = this.opsEmail();
      if (!opsEmail || !this.email.isConfigured()) return;
      await this.send({
        orderId: null,
        recipientType: 'admin',
        to: opsEmail,
        notificationType: 'OPS_VENDOR_REQUEST',
        // One email per request: asking again (a corrected number) is a new request.
        idempotencyKey: `ops-price-request:${input.vendorId}:${input.giftTemplateId}:${input.proposedAt}`,
        subject: `${input.vendorName}: ${input.giftName} ${naira(input.currentPrice)} → ${naira(input.proposedPrice)}`,
        text: [
          `${input.vendorName} asked to change a price.`,
          '',
          `Item: ${input.giftName}`,
          `Now: ${naira(input.currentPrice)}`,
          `Asked for: ${naira(input.proposedPrice)}`,
          '',
          `Senders keep paying ${naira(input.currentPrice)} until you approve or decline:`,
          this.opsLink(input.vendorId),
        ].join('\n'),
      });
    });
  }

  /**
   * Something went wrong at a handover — a failed doorstep delivery or a
   * missed booking — that ops should look at today. One email per event
   * (the key names it), and never throws.
   */
  async handoverProblem(input: {
    orderId: string;
    key: string;
    subject: string;
    lines: string[];
  }): Promise<void> {
    await this.safely(`handover problem ${input.orderId}`, async () => {
      const opsEmail = this.opsEmail();
      if (!opsEmail || !this.email.isConfigured()) return;
      await this.send({
        orderId: input.orderId,
        recipientType: 'admin',
        to: opsEmail,
        notificationType: 'OPS_HANDOVER_PROBLEM',
        idempotencyKey: `ops-handover:${input.key}`,
        subject: input.subject,
        text: input.lines.join('\n'),
      });
    });
  }

  /**
   * The safety net. Every few minutes: anything a vendor hasn't
   * acknowledged within VENDOR_ACK_MINUTES gets one reminder to the
   * vendor and one email to ops. Once each per assignment/booking —
   * the idempotency key carries the moment it was assigned or booked.
   */
  async escalateOverdue(): Promise<{ deliveries: number; pickups: number }> {
    const minutes = this.ackMinutes();
    const cutoff = new Date(Date.now() - minutes * 60_000);
    let deliveries = 0;
    let pickups = 0;

    await this.safely('escalation sweep', async () => {
      const [lateDeliveries, latePickups] = await Promise.all([
        this.repository.unacknowledgedDeliveries(cutoff),
        this.repository.unconfirmedPickups(
          cutoff,
          new Date(Date.now() - 60 * 60_000),
        ),
      ]);

      for (const row of lateDeliveries) {
        const vendor = row.vendors;
        if (!row.orders || !vendor) continue;
        deliveries += 1;
        const gift = row.orders.gift_templates?.name ?? 'a gift';
        const ref = row.orders.order_number ?? row.order_id;
        await this.remindAndEscalate({
          orderId: row.order_id,
          vendor,
          key: `delivery:${row.order_id}:${row.vendor_id}:${row.vendor_notified_at}`,
          what: `delivery ${ref} (${gift}${row.orders.delivery_zone ? `, ${row.orders.delivery_zone}` : ''})`,
          since: row.vendor_notified_at,
        });
      }

      for (const row of latePickups) {
        const vendor = row.vendors;
        if (!vendor) continue;
        pickups += 1;
        const gift = row.gift_templates?.name ?? 'a gift';
        await this.remindAndEscalate({
          orderId: row.id,
          vendor,
          key: `pickup:${row.id}:${row.pickup_vendor_id}:${row.pickup_booked_at}`,
          what: `collection ${row.order_number ?? row.id} (${gift}, ${lagosTime(row.pickup_at)})`,
          since: row.pickup_booked_at,
        });
      }
    });

    if (deliveries + pickups > 0) {
      this.logger.warn(
        `${deliveries} delivery(ies) and ${pickups} booking(s) unacknowledged by their vendor for over ${minutes} minutes — see /ops.`,
      );
    }
    return { deliveries, pickups };
  }

  private async remindAndEscalate(input: {
    orderId: string;
    vendor: VendorContactRow;
    key: string;
    what: string;
    since: string;
  }): Promise<void> {
    if (!this.email.isConfigured()) return;
    const { vendor } = input;
    const waited = Math.round(
      (Date.now() - new Date(input.since).getTime()) / 60_000,
    );

    if (vendor.email) {
      await this.send({
        orderId: input.orderId,
        recipientType: 'vendor',
        to: vendor.email,
        notificationType: 'VENDOR_REMINDER',
        idempotencyKey: `vendor-reminder:${input.key}`,
        subject: `Reminder: please confirm SendEbun ${input.what}`,
        text: [
          `Hi ${vendor.business_name},`,
          '',
          `We haven't had a "Got it" for ${input.what} yet. It's been ${waited} minutes and the customer is waiting.`,
          '',
          `Please open your SendEbun link and confirm, or reply to this email if there's a problem.`,
        ].join('\n'),
      });
    }

    const opsEmail = this.config.get<string>('OPS_ALERT_EMAIL')?.trim();
    if (opsEmail) {
      await this.send({
        orderId: input.orderId,
        recipientType: 'admin',
        to: opsEmail,
        notificationType: 'OPS_ESCALATION',
        idempotencyKey: `ops-escalation:${input.key}`,
        subject: `Call ${vendor.business_name}: ${input.what} unconfirmed for ${waited} min`,
        text: [
          `${vendor.business_name} hasn't acknowledged ${input.what} after ${waited} minutes.`,
          '',
          `WhatsApp: ${vendor.whatsapp_number}`,
          `Second number: ${vendor.backup_phone ?? 'none on file — add one in /ops'}`,
          `Email: ${vendor.email ?? 'none on file'}`,
          '',
          `If they can't do it, reassign it in /ops (Deliveries) or contact the recipient.`,
        ].join('\n'),
      });
    }
  }

  private async send(input: {
    orderId: string | null;
    recipientType: 'vendor' | 'admin';
    to: string;
    notificationType: string;
    idempotencyKey: string;
    subject: string;
    text: string;
  }): Promise<void> {
    const id = await this.repository.claim({
      orderId: input.orderId,
      recipientType: input.recipientType,
      email: input.to,
      notificationType: input.notificationType,
      subject: input.subject,
      idempotencyKey: input.idempotencyKey,
    });
    if (!id) return; // already sent
    try {
      const messageId = await this.email.send({
        to: input.to,
        subject: input.subject,
        text: input.text,
      });
      await this.repository.markSent(id, messageId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Alert email ${input.idempotencyKey} failed: ${message}`,
      );
      await this.repository.markFailed(id, message);
    }
  }

  private async safely(
    label: string,
    work: () => Promise<void>,
  ): Promise<void> {
    try {
      await work();
    } catch (err) {
      this.logger.error(
        `Vendor alert (${label}) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private opsEmail(): string | undefined {
    return this.config.get<string>('OPS_ALERT_EMAIL')?.trim() || undefined;
  }

  /** Where ops acts on a vendor's request. Staff sign in; the link carries no credential. */
  private opsLink(vendorId: string): string {
    const base = (this.config.get<string>('WEB_APP_BASE_URL') ?? '').replace(
      /\/+$/,
      '',
    );
    return `${base}/ops/vendors/${vendorId}`;
  }

  private ackMinutes(): number {
    const raw = Number(this.config.get<string>('VENDOR_ACK_MINUTES'));
    return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_ACK_MINUTES;
  }
}

function naira(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
}

function lagosTime(iso: string): string {
  return new Date(iso).toLocaleString('en-NG', {
    timeZone: 'Africa/Lagos',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}
