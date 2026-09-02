import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsController } from './payments.controller';
import { IdempotencyModule } from 'src/idempotency/idempotency.module';
import { PaystackWebhookService } from './paystack-webhook.service';

@Module({
  imports: [OrdersModule, IdempotencyModule],
  controllers: [PaymentsController],
  providers: [PaystackWebhookService],
})
export class PaymentsModule {}
