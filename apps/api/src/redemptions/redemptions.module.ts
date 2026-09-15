import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { RedemptionsRepository } from './redemptions.repository';
import { RedemptionsService } from './redemptions.service';
import { RedemptionsController } from './redemptions.controller';

@Module({
  imports: [OrdersModule],
  controllers: [RedemptionsController],
  providers: [RedemptionsRepository, RedemptionsService],
  exports: [RedemptionsService],
})
export class RedemptionsModule {}
