import { Module } from '@nestjs/common';
import { EmailSenderService } from './email-sender.service';
import { VendorAlertsRepository } from './vendor-alerts.repository';
import { VendorAlertsService } from './vendor-alerts.service';

/**
 * Vendor and ops alerts by email. Depends only on Supabase and config, so
 * deliveries, reveal and jobs can all import it without a cycle.
 */
@Module({
  providers: [EmailSenderService, VendorAlertsRepository, VendorAlertsService],
  exports: [VendorAlertsService, EmailSenderService],
})
export class AlertsModule {}
