import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { AutoPayoutsService } from '../payouts/auto-payouts.service';
import { backgroundJobsEnabled } from './jobs.config';

/**
 * The safety net under automatic payouts: checks transfers Paystack has
 * gone quiet on, and pays anyone still owed. The immediate attempt after
 * each handover does the real work; this catches what it couldn't
 * finish. Safe on several instances: the database claim decides who pays.
 */
@Injectable()
export class AutoPayoutJob {
  private readonly logger = new Logger(AutoPayoutJob.name);

  constructor(
    private readonly payouts: AutoPayoutsService,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'auto-payouts' })
  async run(): Promise<void> {
    if (
      !backgroundJobsEnabled(this.config.get<string>('ENABLE_BACKGROUND_JOBS'))
    ) {
      return;
    }
    const result = await this.payouts.sweep();
    if (result.checked + result.attempted > 0) {
      this.logger.log(
        `Auto payouts: checked ${result.checked} quiet transfer(s), tried ${result.attempted} vendor(s).`,
      );
    }
  }
}
