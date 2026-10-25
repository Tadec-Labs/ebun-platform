import { Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { FulfillmentOrchestratorService } from '../fulfillment/fulfillment-orchestrator.service';
import {
  PaystackClientService,
  PaystackRefundRejectedError,
} from '../paystack/paystack-client.service';
import {
  DECISION_WINDOW_HOURS,
  GROUP_REFERENCE_PREFIX,
  MAX_REFUND_ATTEMPTS,
  REFUND_BATCH,
} from './group-gifts.config';
import { GroupGiftsRepository } from './group-gifts.repository';

/** SQL errors that a webhook redelivery can never fix. */
const PERMANENT_ERRORS = [
  'contribution_not_found',
  'contribution_amount_mismatch',
];

/**
 * The money side of group gifting, everything driven by Paystack or the
 * clock rather than a person:
 *
 *   charge.success (signature verified by PaystackWebhookService)
 *     └─ confirm_group_contribution()  one locked transaction: count the
 *                                      share; at the target, fund the pot
 *                                      AND create its order
 *     └─ fulfil                        the new order, in the background
 *
 *   refund worker   owed refunds -> Paystack, one claimed row at a time
 *   refund.*        Paystack's progress on those refunds
 *   decision clock  open pots past deadline + 48h close; everyone refunded
 */
@Injectable()
export class GroupGiftFundingService {
  private readonly logger = new Logger(GroupGiftFundingService.name);
  private refunding = false;

  constructor(
    private readonly repository: GroupGiftsRepository,
    private readonly fulfillment: FulfillmentOrchestratorService,
    private readonly paystack: PaystackClientService,
    private readonly audit: AuditService,
  ) {}

  isGroupReference(reference: string | undefined): boolean {
    return Boolean(reference?.startsWith(GROUP_REFERENCE_PREFIX));
  }

  /**
   * Returns normally when the payment is applied, already applied, or can
   * never be applied (recorded loudly for a person to refund). Throws on
   * anything else — a database hiccup — so Paystack redelivers: the SQL
   * is idempotent, and a share must not be lost to a transient error.
   */
  async applyPayment(
    reference: string,
    amountKobo: number,
    transactionId: string,
  ): Promise<void> {
    let result: Awaited<
      ReturnType<GroupGiftsRepository['confirmContribution']>
    >;
    try {
      result = await this.repository.confirmContribution(
        reference,
        amountKobo,
        transactionId,
      );
    } catch (err) {
      const message = errorMessage(err);
      if (PERMANENT_ERRORS.some((code) => message.includes(code))) {
        this.logger.error(
          `GROUP GIFT PAYMENT NOT APPLIED: ${reference} (${amountKobo} kobo, transaction ${transactionId}): ${message}. Refund it from the Paystack dashboard.`,
        );
        await this.audit.record({
          eventType: 'group_gift.payment_unmatched',
          actorId: null,
          actorType: 'webhook',
          resourceType: 'group_gift',
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

    if (result === 'funded') {
      const pot = await this.repository.findByContributionReference(reference);
      if (pot?.linked_order_id) this.afterFunded(pot.id, pot.linked_order_id);
    } else if (result === 'late') {
      this.logger.warn(
        `Group gift contribution ${reference} paid after its pot closed; a full refund is queued.`,
      );
      this.kickRefunds();
    }
  }

  /**
   * The pot is now an ordinary paid order: start its fulfilment, exactly
   * as the sender webhook does. Never delays the caller; the sweep in
   * GroupGiftJob starts anything this misses.
   */
  afterFunded(groupGiftId: string, orderId: string): void {
    this.logger.log(`Group gift ${groupGiftId} funded: order ${orderId}.`);
    setImmediate(() => {
      this.fulfillment
        .start(orderId)
        .catch((err: unknown) =>
          this.logger.warn(
            `Group gift order ${orderId}: fulfilment didn't start (the sweep will retry): ${errorMessage(err)}`,
          ),
        );
    });
  }

  /** Starts the refund worker in the background, now rather than at the next tick. */
  kickRefunds(): void {
    setImmediate(() => {
      this.processRefunds().catch((err: unknown) =>
        this.logger.error(`Group gift refunds failed: ${errorMessage(err)}`),
      );
    });
  }

  /**
   * Sends owed refunds to Paystack. Each row is claimed first
   * (pending -> submitting, guarded in the UPDATE), so two instances or
   * two overlapping runs never send the same refund twice.
   *
   * A refusal from Paystack is final ('failed', shown to ops); a network
   * error puts the row back for the next run, up to MAX_REFUND_ATTEMPTS.
   */
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
            customerNote: 'Refund from SendEbun — your group gift share',
            merchantNote: `SendEbun group gift ${row.group_gift_id}, contribution ${row.id}`,
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
              `GROUP GIFT REFUND FAILED for contribution ${row.id} (${row.refund_amount} kobo): ${errorMessage(err)}. Refund this person by hand.`,
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
    if (!progress) return; // refund.pending / refund.processing: nothing new.

    const row = await this.repository.applyRefundProgress(reference, progress);
    if (!row) {
      this.logger.warn(
        `${event} for ${reference} matched no group gift refund — ignored.`,
      );
      return;
    }
    await this.audit.record({
      eventType: `group_gift.${event}`,
      actorId: null,
      actorType: 'webhook',
      resourceType: 'group_gift',
      resourceId: row.group_gift_id,
      newState: row.refund_status,
      metadata: { contributionId: row.id, amount: row.refund_amount },
    });
  }

  /**
   * Open pots whose decision window ran out: closed as expired, every
   * share refunded in full. Each close is its own locked SQL call, so an
   * organiser deciding at the same moment either wins or finds it closed.
   */
  async closeOverdue(): Promise<number> {
    const before = new Date(Date.now() - DECISION_WINDOW_HOURS * 3_600_000);
    const ids = await this.repository.overdue(before, 50);
    let closed = 0;
    for (const id of ids) {
      const owed = await this.repository.close(
        id,
        'expired',
        `The target wasn't reached and no decision was made within ${DECISION_WINDOW_HOURS} hours of the deadline.`,
        'cron',
      );
      if (owed >= 0) closed += 1;
    }
    if (closed > 0) this.kickRefunds();
    return closed;
  }

  /** Funded pots whose order never started fulfilment (a restart, a failed call). */
  async sweep(): Promise<number> {
    const ids = await this.repository.ordersReadyToFulfil(
      new Date(Date.now() - 2 * 60_000),
      100,
    );
    let started = 0;
    for (const id of ids) {
      try {
        await this.fulfillment.start(id);
        started += 1;
      } catch (err) {
        this.logger.warn(
          `Group gift order ${id}: fulfilment didn't start: ${errorMessage(err)}`,
        );
      }
    }
    return started;
  }
}

function errorMessage(err: unknown): string {
  return err && typeof err === 'object' && 'message' in err
    ? String(err.message)
    : String(err);
}
