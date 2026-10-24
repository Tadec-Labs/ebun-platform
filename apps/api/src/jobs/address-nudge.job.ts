import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AddressNudgeService } from '../deliveries/address-nudge.service';
import { backgroundJobsEnabled } from './jobs.config';

/**
 * Hourly: emails senders whose doorstep gift is still waiting for an
 * address (day 1 and day 3). Hourly is plenty — the nudges are days
 * apart, and an hour's drift on "a day later" is invisible.
 */
@Injectable()
export class AddressNudgeJob {
  private readonly logger = new Logger(AddressNudgeJob.name);

  constructor(
    private readonly nudges: AddressNudgeService,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR, { name: 'address-nudge' })
  async run(): Promise<void> {
    if (
      !backgroundJobsEnabled(this.config.get<string>('ENABLE_BACKGROUND_JOBS'))
    ) {
      return;
    }
    try {
      const sent = await this.nudges.nudgeDue();
      if (sent > 0) this.logger.log(`${sent} address nudge(s) sent.`);
    } catch (err) {
      this.logger.error(
        `Address nudges failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
