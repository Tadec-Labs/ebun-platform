import { Module } from '@nestjs/common';
import { PublicPhotosService } from './public-photos.service';

@Module({
  providers: [PublicPhotosService],
  exports: [PublicPhotosService],
})
export class StorageModule {}
