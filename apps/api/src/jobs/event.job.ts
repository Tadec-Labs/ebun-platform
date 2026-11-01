import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { EventFundingService } from '../events/event-funding.service';
import { backgroundJobsEnabled } from './jobs.config';

/**
 * Events, every five minutes:
 *   - close events whose giving window ended (cash that lands later is refunded);
 *   - send owed cash refunds (cancelled events, late or over-cap gifts).
 *
 * Gift-list items are pots: GroupGiftJob closes and refunds those.
 * Both steps are safe on several instances: closing is a locked SQL
 * call, and each refund is claimed in its UPDATE before it's sent.
 */
@Injectable()
export class EventJob {
  private readonly logger = new Logger(EventJob.name);

  constructor(
    private readonly funding: EventFundingService,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'events' })
  async run(): Promise<void> {
    if (
      !backgroundJobsEnabled(this.config.get<string>('ENABLE_BACKGROUND_JOBS'))
    ) {
      return;
    }
    await this.tick();
  }

  async tick(): Promise<{ closed: number; refunded: number }> {
    let closed = 0;
    let refunded = 0;
    try {
      closed = await this.funding.closeFinished();
    } catch (err) {
      this.logger.error(`Closing finished events failed: ${message(err)}`);
    }
    try {
      refunded = (await this.funding.processRefunds()).sent;
    } catch (err) {
      this.logger.error(`Event refunds failed: ${message(err)}`);
    }
    return { closed, refunded };
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
