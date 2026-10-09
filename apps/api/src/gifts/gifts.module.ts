import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { GiftTemplatesRepository } from './gift-templates.repository';
import { GiftsController } from './gifts.controller';
import { GiftsService } from './gifts.service';
import { OpsGiftsController } from './ops-gifts.controller';
import { OpsGiftsService } from './ops-gifts.service';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [GiftsController, OpsGiftsController],
  providers: [GiftTemplatesRepository, GiftsService, OpsGiftsService],
  exports: [GiftsService],
})
export class GiftsModule {}
