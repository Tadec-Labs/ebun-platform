import { Module } from '@nestjs/common';
import { PaystackClientService } from './paystack-client.service';

@Module({
  providers: [PaystackClientService],
  exports: [PaystackClientService],
})
export class PaystackModule {}
