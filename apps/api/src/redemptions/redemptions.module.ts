import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { OrdersModule } from '../orders/orders.module';
import { RedemptionsRepository } from './redemptions.repository';
import { RedemptionsService } from './redemptions.service';
import { RedemptionsController } from './redemptions.controller';
import { OpsRedemptionsController } from './ops-redemptions.controller';

@Module({
  imports: [OrdersModule, AuthModule, AuditModule],
  controllers: [RedemptionsController, OpsRedemptionsController],
  providers: [RedemptionsRepository, RedemptionsService],
  exports: [RedemptionsService],
})
export class RedemptionsModule {}
