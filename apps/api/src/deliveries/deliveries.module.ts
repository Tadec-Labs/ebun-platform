import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { OrdersModule } from '../orders/orders.module';
import { AlertsModule } from '../alerts/alerts.module';
import { DeliveriesRepository } from './deliveries.repository';
import { DeliveriesService } from './deliveries.service';
import { OpsDeliveriesController } from './ops-deliveries.controller';

/**
 * Doorstep delivery. Imported by RevealModule (the recipient's address)
 * and VendorsModule (the vendor's "To deliver" list); imports nothing
 * from either, so neither import is circular.
 */
@Module({
  imports: [OrdersModule, AuditModule, AuthModule, AlertsModule],
  controllers: [OpsDeliveriesController],
  providers: [DeliveriesRepository, DeliveriesService],
  exports: [DeliveriesService],
})
export class DeliveriesModule {}
