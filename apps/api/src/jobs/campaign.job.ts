import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { CampaignFundingService } from '../corporate/campaign-funding.service';
import { CampaignSendingService } from '../corporate/campaign-sending.service';
import { backgroundJobsEnabled } from './jobs.config';

/**
 * Company campaigns, every five minutes:
 *   - send the links of campaigns whose send time has come;
 *   - start any settled campaign gift whose fulfilment didn't start
 *     (the process restarted mid-campaign, a fulfilment call failed).
 */
@Injectable()
export class CampaignJob {
  private readonly logger = new Logger(CampaignJob.name);

  constructor(
    private readonly funding: CampaignFundingService,
    private readonly sending: CampaignSendingService,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'campaigns' })
  async run(): Promise<void> {
    if (
      !backgroundJobsEnabled(this.config.get<string>('ENABLE_BACKGROUND_JOBS'))
    ) {
      return;
    }
    await this.tick();
  }

  async tick(): Promise<{ started: number; campaignsSent: number }> {
    let started = 0;
    let campaignsSent = 0;
    try {
      started = await this.funding.sweep();
    } catch (err) {
      this.logger.error(
        `Campaign fulfilment sweep failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    try {
      campaignsSent = await this.sending.sendDue();
    } catch (err) {
      this.logger.error(
        `Campaign sending failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return { started, campaignsSent };
  }
}
