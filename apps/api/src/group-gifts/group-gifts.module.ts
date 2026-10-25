import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { FulfillmentModule } from '../fulfillment/fulfillment.module';
import { GiftsModule } from '../gifts/gifts.module';
import { PaystackModule } from '../paystack/paystack.module';
import { PricingModule } from '../pricing/pricing.module';
import { UsersModule } from '../users/users.module';
import { GroupGiftFundingService } from './group-gift-funding.service';
import { GroupGiftOrganiserGuard } from './group-gift-organiser.guard';
import {
  GroupGiftOrganiserController,
  GroupGiftsController,
} from './group-gifts.controller';
import { GroupGiftsRepository } from './group-gifts.repository';
import { GroupGiftsService } from './group-gifts.service';

/**
 * Group gifting. Depends on fulfilment (to start the gift a funded pot
 * becomes); depended on by the Paystack webhook (payments, refunds), the
 * reveal (everyone's lines) and the jobs (decision clock, refunds,
 * safety net). No cycles: nothing here imports any of those three.
 */
@Module({
  imports: [
    AuditModule,
    FulfillmentModule,
    GiftsModule,
    PaystackModule,
    PricingModule,
    UsersModule,
  ],
  controllers: [GroupGiftsController, GroupGiftOrganiserController],
  providers: [
    GroupGiftsRepository,
    GroupGiftsService,
    GroupGiftFundingService,
    GroupGiftOrganiserGuard,
  ],
  exports: [GroupGiftsService, GroupGiftFundingService],
})
export class GroupGiftsModule {}
