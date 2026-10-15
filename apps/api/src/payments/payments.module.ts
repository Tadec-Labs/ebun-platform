import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { FulfillmentModule } from '../fulfillment/fulfillment.module';
import { PaymentsController } from './payments.controller';
import { IdempotencyModule } from 'src/idempotency/idempotency.module';
import { PaystackWebhookService } from './paystack-webhook.service';
import { RefundsModule } from '../refunds/refunds.module';
import { PayoutsModule } from '../payouts/payouts.module';

@Module({
  imports: [
    OrdersModule,
    IdempotencyModule,
    FulfillmentModule,
    RefundsModule,
    PayoutsModule,
  ],
  controllers: [PaymentsController],
  providers: [PaystackWebhookService],
})
export class PaymentsModule {}
