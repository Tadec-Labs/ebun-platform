import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { GiftsModule } from '../gifts/gifts.module';
import { UsersModule } from '../users/users.module';
import { RedemptionsModule } from '../redemptions/redemptions.module';
import { MEDIA_URL_RESOLVER } from '../media/media-url-resolver.interface';
import { UnimplementedMediaUrlResolver } from '../media/unimplemented-media-url-resolver.service';
import { RevealController } from './reveal.controller';
import { RevealService } from './reveal.service';

@Module({
  imports: [OrdersModule, GiftsModule, UsersModule, RedemptionsModule],
  controllers: [RevealController],
  providers: [
    { provide: MEDIA_URL_RESOLVER, useClass: UnimplementedMediaUrlResolver },
    RevealService,
  ],
})
export class RevealModule {}
