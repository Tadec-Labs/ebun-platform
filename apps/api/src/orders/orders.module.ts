import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { GiftsModule } from '../gifts/gifts.module';
import { UsersModule } from '../users/users.module';
import { PaystackModule } from '../paystack/paystack.module';
import { OrderStateMachineService } from './order-state-machine.service';
import { OrdersRepository } from './orders.repository';
import { OrdersService } from './orders.service';
import { CreateOrderService } from './create-order.service';
import { OrdersController } from './orders.controller';
import { OpsOrdersController } from './ops-orders.controller';
import { OpsOrdersRepository } from './ops-orders.repository';
import { OpsOrdersService } from './ops-orders.service';

/**
 * OrdersService is the only export other feature modules should use.
 * OrderStateMachineService stays exported too since it has legitimate
 * standalone uses (e.g. an ops UI asking "what transitions are legal
 * from here" without wanting to perform a write) — OpsOrdersService is
 * now exactly that caller. OrdersRepository is intentionally NOT
 * exported — nothing outside this module should call the atomic write
 * directly, bypassing the guard in OrdersService. OpsOrdersRepository
 * is a separate, read-only class for the same reason: the ops list
 * needs queries, not a route around the state machine.
 *
 * AuthModule is imported for StaffGuard (it re-exports UsersModule, the
 * guard's other dependency); AuditModule for the order timeline's read
 * side.
 */
@Module({
  imports: [GiftsModule, UsersModule, PaystackModule, AuthModule, AuditModule],
  controllers: [OrdersController, OpsOrdersController],
  providers: [
    OrderStateMachineService,
    OrdersRepository,
    OrdersService,
    CreateOrderService,
    OpsOrdersRepository,
    OpsOrdersService,
  ],
  exports: [OrderStateMachineService, OrdersService],
})
export class OrdersModule {}
