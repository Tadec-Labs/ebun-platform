import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { NotificationsService } from '../notifications/notifications.service';
import { RETRY_BATCH, backgroundJobsEnabled } from './jobs.config';

/**
 * Retries WhatsApp sends that failed.
 *
 * The Brief's own failure table says "WhatsApp notification fails →
 * background worker retries 3× with exponential backoff", and the
 * notifications table was built for it (retry_count, max_retries,
 * next_retry_at, and payload kept "for audit/retry"). None of it ran:
 * a failed send was marked failed and forgotten, so a single Termii
 * blip meant a recipient silently never heard about their gift.
 *
 * The live send path still never retries inline — a webhook request is
 * the wrong place to sit waiting on a flaky provider — so failures are
 * recorded there and picked up here five minutes later.
 */
@Injectable()
export class NotificationRetryJob {
  private readonly logger = new Logger(NotificationRetryJob.name);

  constructor(
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'retry-notifications' })
  async run(): Promise<void> {
    if (
      !backgroundJobsEnabled(this.config.get<string>('ENABLE_BACKGROUND_JOBS'))
    ) {
      return;
    }
    await this.retryDue();
  }

  async retryDue() {
    const result = await this.notifications.retryFailedSends(RETRY_BATCH);

    if (result.attempted > 0) {
      this.logger.log(
        `Notification retries: ${result.attempted} due, ${result.sent} sent, ${result.rescheduled} rescheduled, ${result.exhausted} gave up.`,
      );
    }

    return result;
  }
}
