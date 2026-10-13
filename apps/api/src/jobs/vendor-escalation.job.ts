import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { VendorAlertsService } from '../alerts/vendor-alerts.service';
import { backgroundJobsEnabled } from './jobs.config';

/**
 * Every 10 minutes: deliveries and pickup bookings a vendor hasn't
 * acknowledged within VENDOR_ACK_MINUTES get a reminder to the vendor and
 * an email to ops. Each alert goes once (see VendorAlertsService), so
 * running often costs nothing but a query.
 */
@Injectable()
export class VendorEscalationJob {
  constructor(
    private readonly alerts: VendorAlertsService,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'escalate-unacknowledged' })
  async run(): Promise<void> {
    if (
      !backgroundJobsEnabled(this.config.get<string>('ENABLE_BACKGROUND_JOBS'))
    ) {
      return;
    }
    await this.alerts.escalateOverdue();
  }
}
