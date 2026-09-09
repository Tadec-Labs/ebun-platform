import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { TermiiModule } from '../termii/termii.module';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [OrdersModule, TermiiModule],
  providers: [NotificationsRepository, NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
