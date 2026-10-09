import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { GiftsModule } from '../gifts/gifts.module';
import { RedemptionsModule } from '../redemptions/redemptions.module';
import { VendorPortalController } from './vendor-portal.controller';
import { VendorPortalGuard } from './vendor-portal.guard';
import { VendorsController } from './vendors.controller';
import { VendorsRepository } from './vendors.repository';
import { VendorsService } from './vendors.service';

@Module({
  imports: [AuthModule, AuditModule, GiftsModule, RedemptionsModule],
  controllers: [VendorsController, VendorPortalController],
  providers: [VendorsRepository, VendorsService, VendorPortalGuard],
  exports: [VendorsService],
})
export class VendorsModule {}
