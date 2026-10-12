import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { GiftsModule } from '../gifts/gifts.module';
import { OrdersModule } from '../orders/orders.module';
import { RedemptionsModule } from '../redemptions/redemptions.module';
import { StorageModule } from '../storage/storage.module';
import { VendorPortalController } from './vendor-portal.controller';
import { VendorPortalGuard } from './vendor-portal.guard';
import { VendorPortalService } from './vendor-portal.service';
import { VendorsController } from './vendors.controller';
import { VendorsRepository } from './vendors.repository';
import { VendorsService } from './vendors.service';

@Module({
  imports: [
    AuthModule,
    AuditModule,
    GiftsModule,
    OrdersModule,
    RedemptionsModule,
    StorageModule,
  ],
  controllers: [VendorsController, VendorPortalController],
  providers: [
    VendorsRepository,
    VendorsService,
    VendorPortalService,
    VendorPortalGuard,
  ],
  exports: [VendorsService],
})
export class VendorsModule {}
