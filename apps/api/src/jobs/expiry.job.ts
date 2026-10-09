import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { OrderStatus } from '@ebun/types';
import { OrdersService } from '../orders/orders.service';
import { RedemptionsService } from '../redemptions/redemptions.service';
import { OrderTransitionConflictException } from '../orders/exceptions/order-transition-conflict.exception';
import { EXPIRY_BATCH, backgroundJobsEnabled } from './jobs.config';

/**
 * Expires gifts nobody collected inside the 30-day window.
 *
 * WHY NOT expire_unclaimed_gifts(): the schema ships that function and
 * it does the right thing to the rows, but it is a batch UPDATE that
 * writes no audit_events row for the orders it changes. "Every
 * significant state transition is logged to the immutable audit trail"
 * is a non-negotiable in this codebase, and expiry is the transition
 * that decides a sender's money is now owed back — the single worst
 * one to have no record of. So orders are expired one at a time through
 * attempt_order_transition(), which writes its own audit row, and the
 * redemptions half is handled separately (those rows have no state
 * machine and no audit contract).
 *
 * HOURLY, not daily as the schema's comment suggests. Expiry is what
 * will eventually trigger a refund, so up to 24 hours of lag sits
 * directly on top of somebody's money. The query is indexed on
 * expires_at and matches nothing on almost every run.
 *
 * WHAT THIS DOES NOT DO: notify the sender, or initiate a refund. Both
 * are in the Brief's own description of expiry and neither exists yet —
 * there is no refund code anywhere in the API. Expired orders are now
 * at least correctly marked and audited, so the refund work has
 * something truthful to build on.
 */
@Injectable()
export class ExpiryJob {
  private readonly logger = new Logger(ExpiryJob.name);

  constructor(
    private readonly orders: OrdersService,
    private readonly redemptions: RedemptionsService,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR, { name: 'expire-unclaimed' })
  async run(): Promise<void> {
    if (
      !backgroundJobsEnabled(this.config.get<string>('ENABLE_BACKGROUND_JOBS'))
    ) {
      return;
    }
    await this.expireOverdue();
  }

  async expireOverdue(): Promise<{ orders: number; redemptions: number }> {
    const expirable = await this.orders.findExpirable(EXPIRY_BATCH);
    let expired = 0;

    for (const order of expirable) {
      try {
        await this.orders.transitionNormal(
          order.id,
          order.status,
          OrderStatus.Expired,
          { type: 'cron' },
          { expiredAt: new Date().toISOString(), expiresAt: order.expires_at },
        );
        expired += 1;
      } catch (err) {
        if (err instanceof OrderTransitionConflictException) {
          // Someone (or another instance) moved this order between the
          // read and the write — the compare-and-swap did its job.
          // Nothing to fix; it will be re-read next hour if it still
          // qualifies.
          continue;
        }
        this.logger.error(
          `Order ${order.id}: could not expire from ${order.status}.`,
          err instanceof Error ? err.stack : err,
        );
      }
    }

    const expiredRedemptions = await this.redemptions.expireOverdue();

    if (expired > 0 || expiredRedemptions.length > 0) {
      this.logger.warn(
        `Expired ${expired} order(s) and ${expiredRedemptions.length} redemption(s). ` +
          `Each expired order is a gift that was paid for and never collected — these need a refund decision, which nothing automates yet.`,
      );
    }

    return { orders: expired, redemptions: expiredRedemptions.length };
  }
}
