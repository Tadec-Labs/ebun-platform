import { Module } from '@nestjs/common';
import { TermiiWhatsappClientService } from './termii-whatsapp-client.service';

@Module({
  providers: [TermiiWhatsappClientService],
  exports: [TermiiWhatsappClientService],
})
export class TermiiModule {}
