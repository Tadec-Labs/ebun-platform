import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
}

/**
 * Sends one plain-text email through Resend's HTTP API.
 *
 * Plain fetch, no SDK: it is one POST, and a dependency for one POST is
 * one more thing to audit and update. Plain text, no HTML: these are
 * operational alerts read on a phone at a counter, and plain text is what
 * every mail client shows reliably.
 *
 * Optional by design. Without RESEND_API_KEY and ALERTS_FROM_EMAIL it
 * reports itself unconfigured and every alert is skipped (logged once);
 * the vendor's link and /ops still show everything. Nothing fails because
 * email isn't set up.
 */
@Injectable()
export class EmailSenderService {
  private readonly logger = new Logger(EmailSenderService.name);
  private warned = false;

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    const ok = Boolean(this.apiKey() && this.from());
    if (!ok && !this.warned) {
      this.warned = true;
      this.logger.warn(
        'Email alerts are off: set RESEND_API_KEY and ALERTS_FROM_EMAIL to turn them on.',
      );
    }
    return ok;
  }

  /** Resolves to Resend's message id. Throws on any failure — callers record it. */
  async send(email: OutboundEmail): Promise<string> {
    const apiKey = this.apiKey();
    const from = this.from();
    if (!apiKey || !from) throw new Error('Email is not configured.');

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [email.to],
        subject: email.subject,
        text: email.text,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      // Resend's error body names the problem (bad domain, bad key);
      // capped so a huge body can't flood the notifications row.
      const detail = (await res.text().catch(() => '')).slice(0, 300);
      throw new Error(`Resend ${res.status}: ${detail}`);
    }
    const body = (await res.json().catch(() => ({}))) as { id?: unknown };
    return typeof body.id === 'string' ? body.id : 'unknown';
  }

  private apiKey(): string | undefined {
    return this.config.get<string>('RESEND_API_KEY')?.trim() || undefined;
  }

  private from(): string | undefined {
    return this.config.get<string>('ALERTS_FROM_EMAIL')?.trim() || undefined;
  }
}
