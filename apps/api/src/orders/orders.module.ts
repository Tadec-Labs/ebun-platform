import { Module } from '@nestjs/common';
import { OrderStateMachineService } from './order-state-machine.service';
import { OrdersRepository } from './orders.repository';
import { OrdersService } from './orders.service';

/**
 * OrdersService is the only export other feature modules should use.
 * OrderStateMachineService stays exported too since it has legitimate
 * standalone uses (e.g. an ops UI asking "what transitions are legal
 * from here" without wanting to perform a write). OrdersRepository is
 * intentionally NOT exported — nothing outside this module should call
 * the atomic write directly, bypassing the guard in OrdersService.
 */
@Module({
  providers: [OrderStateMachineService, OrdersRepository, OrdersService],
  exports: [OrderStateMachineService, OrdersService],
})
export class OrdersModule {}
