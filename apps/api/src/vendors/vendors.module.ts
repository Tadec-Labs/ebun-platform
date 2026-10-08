import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { GiftsModule } from '../gifts/gifts.module';
import { VendorsController } from './vendors.controller';
import { VendorsRepository } from './vendors.repository';
import { VendorsService } from './vendors.service';

@Module({
  imports: [AuthModule, AuditModule, GiftsModule],
  controllers: [VendorsController],
  providers: [VendorsRepository, VendorsService],
})
export class VendorsModule {}
