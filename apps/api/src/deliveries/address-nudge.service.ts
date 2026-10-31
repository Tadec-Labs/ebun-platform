import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailSenderService } from '../alerts/email-sender.service';
import {
  AwaitingAddressRow,
  DeliveriesRepository,
} from './deliveries.repository';

const DAY_MS = 24 * 60 * 60_000;

/** First nudge after a day without an address, the second after three. */
const NUDGE_AFTER_DAYS = [1, 3] as const;

/**
 * A doorstep gift can't move until the recipient says where to bring it,
 * and SendEbun can't message the recipient itself (no WhatsApp sender
 * yet). The sender can — they're the one who shared the link. So the
 * sender gets two short emails, day 1 and day 3, each with a one-tap
 * WhatsApp message to resend the link.
 *
 * Nothing here is a step for anyone when things go right: a recipient
 * who gives their address on day 0 never triggers it.
 */
@Injectable()
export class AddressNudgeService {
  private readonly logger = new Logger(AddressNudgeService.name);

  constructor(
    private readonly repository: DeliveriesRepository,
    private readonly email: EmailSenderService,
    private readonly config: ConfigService,
  ) {}

  async nudgeDue(now = new Date()): Promise<number> {
    if (!this.email.isConfigured()) return 0;
    const candidates = await this.repository.awaitingAddress(
      new Date(now.getTime() - NUDGE_AFTER_DAYS[0] * DAY_MS),
    );
    let sent = 0;
    for (const row of candidates) {
      const dueAfter = NUDGE_AFTER_DAYS[row.address_nudges];
      if (dueAfter === undefined) continue;
      const age = now.getTime() - new Date(row.created_at).getTime();
      if (age < dueAfter * DAY_MS) continue;
      if (new Date(row.expires_at).getTime() <= now.getTime()) continue;
      const to = row.users?.email;
      if (!to) continue;

      // Claim first: two instances can't both email the same nudge.
      const claimed = await this.repository.recordAddressNudge(
        row.id,
        row.address_nudges,
      );
      if (!claimed) continue;
      try {
        await this.email.send({
          to,
          subject: `${firstName(row.recipient_name)} hasn't said where to bring your gift yet`,
          text: this.body(row),
        });
        sent += 1;
      } catch (err) {
        this.logger.warn(
          `Address nudge for order ${row.id} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return sent;
  }

  private body(row: AwaitingAddressRow): string {
    const base = (this.config.get<string>('WEB_APP_BASE_URL') ?? '').replace(
      /\/+$/,
      '',
    );
    const link = `${base}/reveal/${row.reveal_token}`;
    const name = firstName(row.recipient_name);
    const gift = row.gift_templates?.name ?? 'your gift';
    const message = `Hi ${name}, you have a gift waiting 🎁 Open it here and tell them where to bring it: ${link}`;
    const whatsapp = `https://wa.me/${row.recipient_phone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`;
    const senderName = row.sender_name ?? row.users?.name;
    const sender = senderName ? firstName(senderName) : 'there';
    return [
      `Hi ${sender},`,
      '',
      `${name} hasn't opened ${gift} or told us where to bring it yet, so it's waiting.`,
      '',
      `Send them their link again on WhatsApp (one tap):`,
      whatsapp,
      '',
      `Or share it however you like: ${link}`,
      '',
      `If they don't add an address before the gift expires, you'll get your money back.`,
      '',
      'SendEbun',
    ].join('\n');
  }
}

function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] || full;
}
