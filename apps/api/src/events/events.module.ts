import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { DeliveriesModule } from '../deliveries/deliveries.module';
import { GiftsModule } from '../gifts/gifts.module';
import { GroupGiftsModule } from '../group-gifts/group-gifts.module';
import { PaystackModule } from '../paystack/paystack.module';
import { PricingModule } from '../pricing/pricing.module';
import { UsersModule } from '../users/users.module';
import { EventFundingService } from './event-funding.service';
import { EventHostGuard } from './event-host.guard';
import {
  EventHostController,
  EventsController,
  OpsEventsController,
} from './events.controller';
import { EventsRepository } from './events.repository';
import { EventsService } from './events.service';

/**
 * Events. Builds on group gifting (gift-list items are pots); depended
 * on by the Paystack webhook (cash gifts, their refunds) and the jobs
 * (closing clock, refunds). Nothing here imports either of those.
 */
@Module({
  imports: [
    AuditModule,
    AuthModule,
    DeliveriesModule,
    GiftsModule,
    GroupGiftsModule,
    PaystackModule,
    PricingModule,
    UsersModule,
  ],
  controllers: [EventsController, EventHostController, OpsEventsController],
  providers: [
    EventsRepository,
    EventsService,
    EventFundingService,
    EventHostGuard,
  ],
  exports: [EventFundingService],
})
export class EventsModule {}
