import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { OrdersModule } from '../orders/orders.module';
import { PaystackModule } from '../paystack/paystack.module';
import { RefundsController } from './refunds.controller';
import { RefundsRepository } from './refunds.repository';
import { RefundsService } from './refunds.service';

/**
 * Refunds started from /ops, and Paystack's reports on them. Exports
 * RefundsService so PaymentsModule's webhook can apply refund.* events;
 * depends on nothing that depends on payments, so there is no cycle.
 */
@Module({
  imports: [OrdersModule, PaystackModule, AuditModule, AuthModule],
  controllers: [RefundsController],
  providers: [RefundsRepository, RefundsService],
  exports: [RefundsService],
})
export class RefundsModule {}
