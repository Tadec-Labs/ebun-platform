import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service';
import {
  PaystackClientService,
  PaystackRefundRejectedError,
} from '../paystack/paystack-client.service';
import {
  EVENT_REFERENCE_PREFIX,
  GIVING_DAYS_AFTER,
  MAX_REFUND_ATTEMPTS,
  REFUND_BATCH,
  cashCapKobo,
  lagosToday,
} from './events.config';
import { EventsRepository } from './events.repository';

/** SQL errors a webhook redelivery can never fix. */
const PERMANENT_ERRORS = ['event_gift_not_found', 'event_gift_amount_mismatch'];

/**
 * The money side of events that no person drives:
 *
 *   charge.success (signature verified by PaystackWebhookService)
 *     └─ confirm_event_cash_gift()  one locked transaction: count it, or
 *                                   owe a full refund (event closed, or
 *                                   an unverified host over the cap)
 *   refund worker   owed refunds -> Paystack, one claimed row at a time
 *   refund.*        Paystack's progress on those refunds
 *   closing clock   active events past their giving window close
 *
 * Gift-list money never comes here: those are group-gift pots, handled
 * by GroupGiftFundingService like any other pot.
 */
@Injectable()
export class EventFundingService {
  private readonly logger = new Logger(EventFundingService.name);
  private refunding = false;

  constructor(
    private readonly repository: EventsRepository,
    private readonly paystack: PaystackClientService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  isEventReference(reference: string | undefined): boolean {
    return Boolean(reference?.startsWith(EVENT_REFERENCE_PREFIX));
  }

  capKobo(): number {
    return cashCapKobo(this.config.get<string>('EVENT_CASH_CAP_KOBO'));
  }

  /**
   * Returns normally when applied, already applied, or never applicable
   * (logged loudly for a person to refund by hand). Throws on anything
   * else so Paystack redelivers: the SQL is idempotent.
   */
  async applyPayment(
    reference: string,
    amountKobo: number,
    transactionId: string,
  ): Promise<void> {
    let result: Awaited<ReturnType<EventsRepository['confirmCashGift']>>;
    try {
      result = await this.repository.confirmCashGift(
        reference,
        amountKobo,
        transactionId,
        this.capKobo(),
      );
    } catch (err) {
      const message = errorMessage(err);
      if (PERMANENT_ERRORS.some((code) => message.includes(code))) {
        this.logger.error(
          `EVENT CASH GIFT NOT APPLIED: ${reference} (${amountKobo} kobo, transaction ${transactionId}): ${message}. Refund it from the Paystack dashboard.`,
        );
        await this.audit.record({
          eventType: 'event.payment_unmatched',
          actorId: null,
          actorType: 'webhook',
          resourceType: 'event',
          resourceId: '00000000-0000-0000-0000-000000000000',
          metadata: {
            reference,
            amount: amountKobo,
            transactionId,
            reason: message.slice(0, 300),
          },
        });
        return;
      }
      throw err;
    }

    if (result === 'late' || result === 'over_cap') {
      this.logger.warn(
        `Event cash gift ${reference} couldn't be kept (${result}); a full refund is queued.`,
      );
      this.kickRefunds();
    }
  }

  kickRefunds(): void {
    setImmediate(() => {
      this.processRefunds().catch((err: unknown) =>
        this.logger.error(`Event refunds failed: ${errorMessage(err)}`),
      );
    });
  }

  /** Same claim-then-send discipline as group gift refunds. */
  async processRefunds(): Promise<{ sent: number; failed: number }> {
    if (this.refunding) return { sent: 0, failed: 0 };
    this.refunding = true;
    let sent = 0;
    let failed = 0;
    try {
      const ids = await this.repository.refundsOwed(REFUND_BATCH);
      for (const id of ids) {
        const row = await this.repository.claimRefund(id);
        if (!row || !row.refund_amount) continue;
        try {
          const refund = await this.paystack.createRefund({
            transactionReference: row.paystack_reference,
            amountKobo: row.refund_amount,
            customerNote: 'Refund from SendEbun — your event gift',
            merchantNote: `SendEbun event ${row.event_id}, cash gift ${row.id}`,
          });
          await this.repository.refundSubmitted(row.id, refund.id);
          sent += 1;
        } catch (err) {
          const attempts = row.refund_attempts + 1;
          const refused = err instanceof PaystackRefundRejectedError;
          const giveUp = refused || attempts >= MAX_REFUND_ATTEMPTS;
          await this.repository.refundNotSent(
            row.id,
            attempts,
            refused
              ? `Paystack: ${err.message}`
              : `Couldn't reach Paystack: ${errorMessage(err)}`,
            giveUp,
          );
          if (giveUp) {
            failed += 1;
            this.logger.error(
              `EVENT REFUND FAILED for cash gift ${row.id} (${row.refund_amount} kobo): ${errorMessage(err)}. Refund this guest by hand.`,
            );
          }
        }
      }
    } finally {
      this.refunding = false;
    }
    return { sent, failed };
  }

  async applyRefundEvent(
    event: string,
    reference: string | undefined,
  ): Promise<void> {
    if (!reference) return;
    const progress =
      event === 'refund.processed'
        ? 'completed'
        : event === 'refund.failed'
          ? 'failed'
          : event === 'refund.needs-attention'
            ? 'needs_attention'
            : null;
    if (!progress) return;

    const row = await this.repository.applyRefundProgress(reference, progress);
    if (!row) {
      this.logger.warn(
        `${event} for ${reference} matched no event refund — ignored.`,
      );
      return;
    }
    await this.audit.record({
      eventType: `event.${event}`,
      actorId: null,
      actorType: 'webhook',
      resourceType: 'event',
      resourceId: row.event_id,
      newState: row.refund_status,
      metadata: { giftId: row.id, amount: row.refund_amount },
    });
  }

  /**
   * Active events whose giving window has ended: date + GIVING_DAYS_AFTER
   * days, in Lagos. Closing is a locked SQL call, so a host acting at the
   * same moment either wins or finds it closed.
   */
  async closeFinished(now: Date = new Date()): Promise<number> {
    const today = lagosToday(now);
    const last = new Date(`${today}T00:00:00Z`);
    last.setUTCDate(last.getUTCDate() - GIVING_DAYS_AFTER - 1);
    const ids = await this.repository.activeOnOrBefore(
      last.toISOString().slice(0, 10),
      100,
    );
    let closed = 0;
    for (const id of ids) {
      if (await this.repository.close(id, 'cron')) closed += 1;
    }
    return closed;
  }
}

function errorMessage(err: unknown): string {
  return err && typeof err === 'object' && 'message' in err
    ? String(err.message)
    : String(err);
}
