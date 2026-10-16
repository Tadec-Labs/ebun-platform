import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { OrdersModule } from '../orders/orders.module';
import { GiftsModule } from '../gifts/gifts.module';
import { UsersModule } from '../users/users.module';
import { RedemptionsModule } from '../redemptions/redemptions.module';
import { VendorsModule } from '../vendors/vendors.module';
import { DeliveriesModule } from '../deliveries/deliveries.module';
import { AlertsModule } from '../alerts/alerts.module';
import { MediaModule } from '../media/media.module';
import { CorporateModule } from '../corporate/corporate.module';
import { RevealController } from './reveal.controller';
import { RevealService } from './reveal.service';

@Module({
  imports: [
    OrdersModule,
    GiftsModule,
    UsersModule,
    RedemptionsModule,
    VendorsModule,
    DeliveriesModule,
    AlertsModule,
    AuditModule,
    MediaModule,
    CorporateModule,
  ],
  controllers: [RevealController],
  providers: [RevealService],
})
export class RevealModule {}
