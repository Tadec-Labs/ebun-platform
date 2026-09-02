import { Injectable } from '@nestjs/common';
import { OrderStatus } from '@ebun/types';
import { OrderStateMachineService } from './order-state-machine.service';
import {
  OrdersRepository,
  OrderTransitionActorType,
} from './orders.repository';
import { OrderTransitionConflictException } from './exceptions/order-transition-conflict.exception';

export interface TransitionActor {
  type: OrderTransitionActorType;
  id?: string | null;
}

/**
 * The entry point every other module (payments, fulfillment, redemption, cron jobs, a future ops module) should call to change an order's status — never call OrdersRepository or the Postgres RPC directly. transitionNormal/transitionAdminOverride mirror OrderStateMachineService's own normal/admin split for the same reason documented there: keeping them separate methods means a caller has to say which kind of transition it's attempting, rather than one permissive method quietly allowing either.
 */
@Injectable()
export class OrdersService {
  constructor(
    private readonly stateMachine: OrderStateMachineService,
    private readonly ordersRepository: OrdersRepository,
  ) {}

  /** For webhook/vendor/recipient/cron-driven transitions. */
  async transitionNormal(
    orderId: string,
    from: OrderStatus,
    to: OrderStatus,
    actor: TransitionActor,
    metadata?: Record<string, unknown>,
  ) {
    this.stateMachine.assertNormalTransition(from, to); // throws InvalidOrderTransitionException if illegal
    return this.applyTransition(orderId, from, to, actor, metadata);
  }

  /** For an ops/admin-authorized override — caller's guard/controller must check roles. */
  async transitionAdminOverride(
    orderId: string,
    from: OrderStatus,
    to: OrderStatus,
    actor: TransitionActor,
    metadata?: Record<string, unknown>,
  ) {
    this.stateMachine.assertAdminOverrideTransition(from, to);
    return this.applyTransition(orderId, from, to, actor, metadata);
  }

  /**
   * Read-only — no guard needed, this doesn't change anything. Exists on OrdersService rather than exposing OrdersRepository directly to other modules, so OrdersService stays the single public surface for everything order-related (reads included), keeping the "only write through the guard" boundary from also becoming a maze of "which reads am I allowed to reach directly" exceptions.
   */
  async findByPaystackReference(reference: string) {
    return this.ordersRepository.findByPaystackReference(reference);
  }

  private async applyTransition(
    orderId: string,
    from: OrderStatus,
    to: OrderStatus,
    actor: TransitionActor,
    metadata?: Record<string, unknown>,
  ) {
    const result = await this.ordersRepository.attemptTransition({
      orderId,
      expectedStatus: from,
      newStatus: to,
      actorType: actor.type,
      actorId: actor.id,
      metadata,
    });

    if (!result) {
      throw new OrderTransitionConflictException(orderId, from, to);
    }

    return result;
  }
}
