import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { GiftsModule } from '../gifts/gifts.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { GiftFulfillmentsRepository } from './gift-fulfillments.repository';
import { DigitalVoucherService } from './digital-voucher.service';
import { VTU_PROVIDER } from './vtu-provider.interface';
import { UnimplementedVtuProviderService } from './unimplemented-vtu-provider.service';
import { FulfillmentOrchestratorService } from './fulfillment-orchestrator.service';

/**
 * Only FulfillmentOrchestratorService is exported — same "one public
 * surface per module" boundary as OrdersModule/OrdersService. Nothing
 * outside this module should reach GiftFulfillmentsRepository, the
 * voucher generator, or the VTU provider binding directly.
 *
 * VTU_PROVIDER is bound to UnimplementedVtuProviderService here —
 * swapping in a real Nellobytes/Shago/BuyPower client later is a
 * one-line change to this `useClass`, with zero changes to
 * FulfillmentOrchestratorService itself.
 */
@Module({
  imports: [OrdersModule, GiftsModule, NotificationsModule],
  providers: [
    GiftFulfillmentsRepository,
    DigitalVoucherService,
    { provide: VTU_PROVIDER, useClass: UnimplementedVtuProviderService },
    FulfillmentOrchestratorService,
  ],
  exports: [FulfillmentOrchestratorService],
})
export class FulfillmentModule {}
