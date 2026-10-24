import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { OrdersModule } from '../orders/orders.module';
import { AlertsModule } from '../alerts/alerts.module';
import { PayoutsModule } from '../payouts/payouts.module';
import { DeliveriesRepository } from './deliveries.repository';
import { DeliveriesService } from './deliveries.service';
import { AddressNudgeService } from './address-nudge.service';
import { OpsDeliveriesController } from './ops-deliveries.controller';
import { DeliveryAreasController } from './delivery-areas.controller';

/**
 * Doorstep delivery. Imported by RevealModule (the recipient's address)
 * and VendorsModule (the vendor's "To deliver" list); imports nothing
 * from either, so neither import is circular.
 */
@Module({
  imports: [OrdersModule, AuditModule, AuthModule, AlertsModule, PayoutsModule],
  controllers: [OpsDeliveriesController, DeliveryAreasController],
  providers: [DeliveriesRepository, DeliveriesService, AddressNudgeService],
  exports: [DeliveriesService, AddressNudgeService],
})
export class DeliveriesModule {}
