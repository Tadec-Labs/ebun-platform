import { Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module';
import { PayoutsModule } from '../payouts/payouts.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { GiftsModule } from '../gifts/gifts.module';
import { OrdersModule } from '../orders/orders.module';
import { DeliveriesModule } from '../deliveries/deliveries.module';
import { RedemptionsModule } from '../redemptions/redemptions.module';
import { StorageModule } from '../storage/storage.module';
import { VendorPortalController } from './vendor-portal.controller';
import { VendorPortalGuard } from './vendor-portal.guard';
import { VendorPortalService } from './vendor-portal.service';
import { VendorsController } from './vendors.controller';
import { VendorsRepository } from './vendors.repository';
import { VendorsService } from './vendors.service';
import { EarningsService } from './earnings.service';
import { PayoutsRepository } from './payouts.repository';

@Module({
  imports: [
    AlertsModule,
    AuthModule,
    PayoutsModule,
    AuditModule,
    GiftsModule,
    OrdersModule,
    DeliveriesModule,
    RedemptionsModule,
    StorageModule,
  ],
  controllers: [VendorsController, VendorPortalController],
  providers: [
    VendorsRepository,
    VendorsService,
    VendorPortalService,
    PayoutsRepository,
    EarningsService,
    VendorPortalGuard,
  ],
  exports: [VendorsService],
})
export class VendorsModule {}
