import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailSenderService } from '../alerts/email-sender.service';
import { AuditService } from '../audit/audit.service';
import {
  CampaignRecipientRow,
  CampaignRow,
  CampaignsRepository,
} from './campaigns.repository';

/** Resend allows 2 requests a second on its standard plans; stay under it. */
const EMAIL_SPACING_MS = 600;

export interface SendOutcome {
  emailed: number;
  failed: number;
  /** No email on the list — HR shares these from the link sheet. */
  noEmail: number;
}

/**
 * Gets each person their link.
 *
 * Two routes, both available from day one:
 *   - email, sent by SendEbun at the campaign's send time (Resend);
 *   - the link sheet — every person's link in a CSV — for HR to share
 *     however they like (their own email, WhatsApp, Slack).
 * WhatsApp from SendEbun's own number follows once Meta is set up.
 *
 * Campaign orders never go through NotificationsService (that path is
 * Termii WhatsApp for single gifts); this is their only sender.
 */
@Injectable()
export class CampaignSendingService {
  private readonly logger = new Logger(CampaignSendingService.name);
  private readonly sending = new Set<string>();
  /** Gap between emails; tests set it to 0. */
  spacingMs = EMAIL_SPACING_MS;

  constructor(
    private readonly repository: CampaignsRepository,
    private readonly email: EmailSenderService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  /** The job: every paid campaign whose time has come. */
  async sendDue(): Promise<number> {
    const due = await this.repository.campaignsDueToSend(10);
    for (const campaign of due) {
      await this.send(campaign, 'scheduled').catch((err: unknown) =>
        this.logger.error(
          `Campaign ${campaign.id}: sending failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }
    return due.length;
  }

  /** Right after payment, for a campaign with no send time (or one already passed). */
  async sendIfDue(campaignId: string): Promise<void> {
    const campaign = await this.repository.findById(campaignId);
    if (!campaign || campaign.status !== 'paid' || campaign.links_sent_at)
      return;
    if (campaign.send_at && new Date(campaign.send_at) > new Date()) return;
    await this.send(campaign, 'scheduled');
  }

  /**
   * Emails everyone with an email address who hasn't had theirs yet.
   * Used for the first send and for "try the failed ones again".
   */
  async send(
    campaign: CampaignRow,
    why: 'scheduled' | 'retry',
  ): Promise<SendOutcome> {
    const outcome: SendOutcome = { emailed: 0, failed: 0, noEmail: 0 };
    if (campaign.status !== 'paid' || this.sending.has(campaign.id))
      return outcome;
    this.sending.add(campaign.id);
    try {
      const [recipients, orders] = await Promise.all([
        this.repository.recipients(campaign.id),
        this.repository.orders(campaign.id),
      ]);
      const tokenByOrder = new Map(orders.map((o) => [o.id, o]));
      const canEmail = this.email.isConfigured();

      for (const person of recipients) {
        if (person.link_sent_at || !person.order_id) continue;
        if (!person.email) {
          outcome.noEmail += 1;
          continue;
        }
        if (!canEmail) {
          outcome.failed += 1;
          await this.repository.markLinkSent(
            person.id,
            'Email is not set up yet — share from the link sheet.',
          );
          continue;
        }
        const order = tokenByOrder.get(person.order_id);
        if (!order) continue;
        try {
          await this.email.send({
            to: person.email,
            subject: `${campaign.company_name}: a gift for you`,
            text: this.emailText(
              campaign,
              person,
              this.revealUrl(order.reveal_token),
              order.expires_at,
            ),
          });
          await this.repository.markLinkSent(person.id, null);
          outcome.emailed += 1;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await this.repository.markLinkSent(person.id, message);
          outcome.failed += 1;
        }
        await sleep(this.spacingMs);
      }

      await this.repository.markLinksSent(campaign.id);
      await this.audit.record({
        eventType: 'campaign.links_sent',
        actorId: null,
        actorType: why === 'retry' ? 'user' : 'cron',
        resourceType: 'campaign',
        resourceId: campaign.id,
        metadata: { ...outcome, why },
      });
      this.logger.log(
        `Campaign ${campaign.id}: ${outcome.emailed} emailed, ${outcome.failed} failed, ${outcome.noEmail} without email.`,
      );
      return outcome;
    } finally {
      this.sending.delete(campaign.id);
    }
  }

  /** Everyone's link, for HR to share themselves. CSV, opens in Excel. */
  async linkSheet(campaign: CampaignRow): Promise<string> {
    const [recipients, orders] = await Promise.all([
      this.repository.recipients(campaign.id),
      this.repository.orders(campaign.id),
    ]);
    const orderById = new Map(orders.map((o) => [o.id, o]));
    const lines = [
      ['Name', 'Phone', 'Email', 'Note', 'Gift link', 'Claim by']
        .map(csvCell)
        .join(','),
    ];
    for (const person of recipients) {
      const order = person.order_id
        ? orderById.get(person.order_id)
        : undefined;
      lines.push(
        [
          person.name,
          person.phone,
          person.email ?? '',
          person.note ?? '',
          order ? this.revealUrl(order.reveal_token) : '',
          order ? order.expires_at.slice(0, 10) : '',
        ]
          .map(csvCell)
          .join(','),
      );
    }
    // BOM so Excel reads names with accents correctly.
    return '\uFEFF' + lines.join('\r\n') + '\r\n';
  }

  revealUrl(token: string): string {
    const base = (this.config.get<string>('WEB_APP_BASE_URL') ?? '').replace(
      /\/+$/,
      '',
    );
    return `${base}/reveal/${token}`;
  }

  private emailText(
    campaign: CampaignRow,
    person: CampaignRecipientRow,
    url: string,
    expiresAt: string,
  ): string {
    const firstName = person.name.split(' ')[0];
    const from = campaign.sender_display_name
      ? `${campaign.sender_display_name} at ${campaign.company_name}`
      : campaign.company_name;
    const until = new Date(expiresAt).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Africa/Lagos',
    });
    return [
      `Hi ${firstName},`,
      '',
      `${from} has sent you a gift — "${campaign.title}".`,
      '',
      'Open it here:',
      url,
      '',
      `It's yours to claim until ${until}. This link is just for you, so please don't forward it.`,
      '',
      'Enjoy,',
      'SendEbun',
    ].join('\n');
  }
}

function csvCell(value: string): string {
  // Leading = + - @ would be run as a formula by Excel; neutralise it.
  const safe =
    /^[=+\-@]/.test(value) && !/^\+\d/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
