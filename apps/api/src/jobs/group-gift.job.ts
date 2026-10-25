import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { GroupGiftFundingService } from '../group-gifts/group-gift-funding.service';
import { backgroundJobsEnabled } from './jobs.config';

/**
 * Group gifts, every five minutes:
 *   - close pots whose decision window ran out (everyone refunded);
 *   - send owed refunds to Paystack;
 *   - start any funded pot's order whose fulfilment didn't start.
 *
 * Each step is individually safe on several instances: closing is a
 * locked SQL call, each refund is claimed in its UPDATE before it's
 * sent, and fulfilment goes through the order compare-and-swap.
 */
@Injectable()
export class GroupGiftJob {
  private readonly logger = new Logger(GroupGiftJob.name);

  constructor(
    private readonly funding: GroupGiftFundingService,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'group-gifts' })
  async run(): Promise<void> {
    if (
      !backgroundJobsEnabled(this.config.get<string>('ENABLE_BACKGROUND_JOBS'))
    ) {
      return;
    }
    await this.tick();
  }

  async tick(): Promise<{ closed: number; refunded: number; started: number }> {
    let closed = 0;
    let refunded = 0;
    let started = 0;
    try {
      closed = await this.funding.closeOverdue();
    } catch (err) {
      this.logger.error(`Closing overdue group gifts failed: ${message(err)}`);
    }
    try {
      refunded = (await this.funding.processRefunds()).sent;
    } catch (err) {
      this.logger.error(`Group gift refunds failed: ${message(err)}`);
    }
    try {
      started = await this.funding.sweep();
    } catch (err) {
      this.logger.error(`Group gift fulfilment sweep failed: ${message(err)}`);
    }
    return { closed, refunded, started };
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
