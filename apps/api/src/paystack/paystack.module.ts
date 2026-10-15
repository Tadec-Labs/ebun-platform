import { Module } from '@nestjs/common';
import { PaystackClientService } from './paystack-client.service';
import { PaystackTransfersService } from './paystack-transfers.service';

@Module({
  providers: [PaystackClientService, PaystackTransfersService],
  exports: [PaystackClientService, PaystackTransfersService],
})
export class PaystackModule {}
