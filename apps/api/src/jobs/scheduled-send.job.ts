import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { NotificationsService } from '../notifications/notifications.service';
import { OrdersService } from '../orders/orders.service';
import { SCHEDULED_SEND_BATCH, backgroundJobsEnabled } from './jobs.config';

/**
 * Sends the gifts a sender asked to be delivered later.
 *
 * THIS JOB CLOSES A HOLE THAT WAS TAKING REAL MONEY. /send offers
 * "schedule for later"; payment was captured and the voucher issued,
 * and then NotificationsService saw a future scheduled_send_at, logged
 * that it needed a scheduler, and returned. Nothing existed to pick it
 * up, so a scheduled gift was paid for and never delivered. Everything
 * else in this module is hardening; this part is a bug fix.
 *
 * Every five minutes, because the granularity a sender picks is a
 * date and a time of day, not a second — five minutes of drift on
 * "Saturday morning" is invisible, and polling more often buys nothing.
 */
@Injectable()
export class ScheduledSendJob {
  private readonly logger = new Logger(ScheduledSendJob.name);

  constructor(
    private readonly orders: OrdersService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'scheduled-send' })
  async run(): Promise<void> {
    if (
      !backgroundJobsEnabled(this.config.get<string>('ENABLE_BACKGROUND_JOBS'))
    ) {
      return;
    }
    await this.dispatchDue();
  }

  /** Separated from the @Cron wrapper so it can be called and asserted on directly. */
  async dispatchDue(): Promise<{ due: number; failures: number }> {
    const due = await this.orders.findScheduledSendsDue(SCHEDULED_SEND_BATCH);
    if (due.length === 0) {
      return { due: 0, failures: 0 };
    }

    this.logger.log(`${due.length} scheduled gift(s) due to be sent.`);
    let failures = 0;

    for (const order of due) {
      try {
        // sendGiftRevealLink re-checks scheduled_send_at itself and is
        // guarded by a UNIQUE idempotency key, so calling it here is
        // safe even if two instances pick up the same order at once.
        // A send that fails is recorded as a failed notification and
        // becomes the retry job's problem, not this one's.
        await this.notifications.sendGiftRevealLink(order);
      } catch (err) {
        // One unsendable gift must not abandon the rest of the batch.
        failures += 1;
        this.logger.error(
          `Order ${order.id}: scheduled send failed unexpectedly.`,
          err instanceof Error ? err.stack : err,
        );
      }
    }

    return { due: due.length, failures };
  }
}
