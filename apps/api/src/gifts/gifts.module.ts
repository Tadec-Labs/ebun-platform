import { Module } from '@nestjs/common';
import { GiftTemplatesRepository } from './gift-templates.repository';
import { GiftsService } from './gifts.service';

@Module({
  providers: [GiftTemplatesRepository, GiftsService],
  exports: [GiftsService],
})
export class GiftsModule {}
