import { Module } from '@nestjs/common';
import { OrderStateMachineService } from './order-state-machine.service';

/**
 * Deliberately minimal for now — just the state machine. No controller, no
 * DTOs, no persistence-layer OrdersService yet; those come once
 * payments/fulfillment/redemption exist to actually drive them. Exporting
 * OrderStateMachineService so other feature modules can inject it as soon
 * as they're built.
 */
@Module({
  providers: [OrderStateMachineService],
  exports: [OrderStateMachineService],
})
export class OrdersModule {}
