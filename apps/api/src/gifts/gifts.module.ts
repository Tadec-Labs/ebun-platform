import { Module } from '@nestjs/common';
import { GiftTemplatesRepository } from './gift-templates.repository';
import { GiftsController } from './gifts.controller';
import { GiftsService } from './gifts.service';

@Module({
  controllers: [GiftsController],
  providers: [GiftTemplatesRepository, GiftsService],
  exports: [GiftsService],
})
export class GiftsModule {}
