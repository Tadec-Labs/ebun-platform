import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { OrdersService } from '../orders/orders.service';
import {
  STUCK_FULFILLMENT_MINUTES,
  STUCK_SCAN_BATCH,
  backgroundJobsEnabled,
} from './jobs.config';

/**
 * Finds paid orders that entered fulfilment and never came out.
 *
 * How they get stuck: fulfilment runs synchronously inside the Paystack
 * webhook request, and that webhook's idempotency key is claimed BEFORE
 * fulfilment starts. If fulfilment throws partway, a Paystack
 * redelivery short-circuits on the claimed key and never retries — the
 * order sits at processing or fulfillment_in_progress forever. The
 * money is taken and the recipient has nothing.
 *
 * DELIBERATELY READ-ONLY. It would be easy to auto-transition these to
 * fulfillment_failed, and wrong: the two reasonable responses are
 * "retry the fulfilment" and "refund the sender", and which one applies
 * depends on why it failed. Marking it failed automatically would
 * destroy the state a human needs to decide, and would make a refundable
 * order look resolved. So this reports and leaves the order alone.
 *
 * No audit_events row either: nothing changed state, and audit_events is
 * the log of transitions, not of observations. The signal belongs in
 * logs and, once it exists, in the ops dashboard.
 *
 * Every fifteen minutes. Until alerting exists, this log line is the
 * only way anyone finds out — so it is written at error level, with the
 * order numbers spelled out, for exactly that reason.
 */
@Injectable()
export class StuckOrderJob {
  private readonly logger = new Logger(StuckOrderJob.name);

  constructor(
    private readonly orders: OrdersService,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES, { name: 'detect-stuck-orders' })
  async run(): Promise<void> {
    if (
      !backgroundJobsEnabled(this.config.get<string>('ENABLE_BACKGROUND_JOBS'))
    ) {
      return;
    }
    await this.detect();
  }

  async detect(): Promise<{ stuck: number; orderIds: string[] }> {
    const cutoff = new Date(Date.now() - STUCK_FULFILLMENT_MINUTES * 60_000);
    const stuck = await this.orders.findStuckInFulfillment(
      cutoff,
      STUCK_SCAN_BATCH,
    );

    if (stuck.length === 0) {
      return { stuck: 0, orderIds: [] };
    }

    const described = stuck
      .map((order) => `${order.order_number ?? order.id} (${order.status})`)
      .join(', ');

    this.logger.error(
      `${stuck.length} paid order(s) have been stuck in fulfilment for over ${STUCK_FULFILLMENT_MINUTES} minutes and will NOT retry on their own: ${described}. ` +
        `Each one is money taken with nothing delivered — decide per order between re-running fulfilment and refunding.`,
    );

    return { stuck: stuck.length, orderIds: stuck.map((order) => order.id) };
  }
}
