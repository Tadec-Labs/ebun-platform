import { Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { FulfillmentModule } from '../fulfillment/fulfillment.module';
import { GiftsModule } from '../gifts/gifts.module';
import { MediaModule } from '../media/media.module';
import { PaystackModule } from '../paystack/paystack.module';
import { PricingModule } from '../pricing/pricing.module';
import { CampaignFundingService } from './campaign-funding.service';
import { CampaignGiftsService } from './campaign-gifts.service';
import { CampaignPortalController } from './campaign-portal.controller';
import { CampaignPortalGuard } from './campaign-portal.guard';
import { CampaignSendingService } from './campaign-sending.service';
import { CampaignsRepository } from './campaigns.repository';
import { CampaignsService } from './campaigns.service';
import { OpsCampaignsController } from './ops-campaigns.controller';

/**
 * Company campaigns. Depends on fulfilment (to start each person's gift)
 * but nothing depends back on it except the three callers that need it:
 * the Paystack webhook (funding), the reveal page (choice and thanks)
 * and the jobs (sending, safety net). No cycles.
 */
@Module({
  imports: [
    AuditModule,
    AuthModule,
    AlertsModule,
    FulfillmentModule,
    GiftsModule,
    MediaModule,
    PaystackModule,
    PricingModule,
  ],
  controllers: [CampaignPortalController, OpsCampaignsController],
  providers: [
    CampaignsRepository,
    CampaignsService,
    CampaignFundingService,
    CampaignSendingService,
    CampaignGiftsService,
    CampaignPortalGuard,
  ],
  exports: [
    CampaignFundingService,
    CampaignSendingService,
    CampaignGiftsService,
  ],
})
export class CorporateModule {}
