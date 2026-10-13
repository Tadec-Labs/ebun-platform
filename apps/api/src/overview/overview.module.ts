import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DeliveriesModule } from '../deliveries/deliveries.module';
import { OrdersModule } from '../orders/orders.module';
import { OpsOverviewController } from './ops-overview.controller';
import { OverviewRepository } from './overview.repository';
import { OverviewService } from './overview.service';

@Module({
  imports: [AuthModule, DeliveriesModule, OrdersModule],
  controllers: [OpsOverviewController],
  providers: [OverviewRepository, OverviewService],
})
export class OverviewModule {}
