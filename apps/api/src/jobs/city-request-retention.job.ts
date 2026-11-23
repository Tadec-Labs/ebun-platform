import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CitiesService } from '../cities/cities.service';
import { backgroundJobsEnabled } from './jobs.config';

/**
 * Daily: clears the email/phone on "tell me when you open in my city"
 * requests older than 12 months. The city itself is kept — it's how we
 * choose where to open next — but the person behind it isn't, once the
 * reason we asked has had a year to come true.
 */
@Injectable()
export class CityRequestRetentionJob {
  private readonly logger = new Logger(CityRequestRetentionJob.name);

  constructor(
    private readonly cities: CitiesService,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'city-request-retention' })
  async run(): Promise<void> {
    if (
      !backgroundJobsEnabled(this.config.get<string>('ENABLE_BACKGROUND_JOBS'))
    ) {
      return;
    }
    try {
      const cleared = await this.cities.applyContactRetention();
      if (cleared > 0) {
        this.logger.log(
          `Cleared ${cleared} city-request contact(s) past retention.`,
        );
      }
    } catch (err) {
      this.logger.error(
        `City-request retention failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
