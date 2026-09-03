import { Module } from '@nestjs/common';
import { GiftsModule } from '../gifts/gifts.module';
import { UsersModule } from '../users/users.module';
import { PaystackModule } from '../paystack/paystack.module';
import { OrderStateMachineService } from './order-state-machine.service';
import { OrdersRepository } from './orders.repository';
import { OrdersService } from './orders.service';
import { CreateOrderService } from './create-order.service';
import { OrdersController } from './orders.controller';

/**
 * OrdersService is the only export other feature modules should use.
 * OrderStateMachineService stays exported too since it has legitimate
 * standalone uses (e.g. an ops UI asking "what transitions are legal
 * from here" without wanting to perform a write). OrdersRepository is
 * intentionally NOT exported — nothing outside this module should call
 * the atomic write directly, bypassing the guard in OrdersService.
 */
@Module({
  imports: [GiftsModule, UsersModule, PaystackModule],
  controllers: [OrdersController],
  providers: [
    OrderStateMachineService,
    OrdersRepository,
    OrdersService,
    CreateOrderService,
  ],
  exports: [OrderStateMachineService, OrdersService],
})
export class OrdersModule {}
