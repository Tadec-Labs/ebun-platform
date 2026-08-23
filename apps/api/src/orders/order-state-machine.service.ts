import { Injectable } from '@nestjs/common';
import { OrderStatus } from '@ebun/types';
import {
  ADMIN_OVERRIDE_TRANSITIONS,
  NORMAL_TRANSITIONS,
  canTransition,
  getAllowedTransitions,
  isAdminOverrideTransition,
  isNormalTransition,
  isTerminal,
} from './order-state-machine';
import { InvalidOrderTransitionException } from './exceptions/invalid-order-transition.exception';

/**
 * Injectable entry point for the order state machine. This is what other
 * NestJS modules (payments, fulfillment, redemption, a future ops module)
 * should inject — never import order-state-machine.ts's functions directly
 * from another module; go through this service so there's one DI-tracked
 * chokepoint for every status write in the system.
 *
 * `assertNormalTransition` and `assertAdminOverrideTransition` are
 * deliberately separate methods rather than one `assertTransition(from, to)`
 * — see order-state-machine.ts's file header for why merging them would be
 * a real security footgun (a normal-flow bug could silently trigger an
 * admin-only transition like `paid → refunded`). Callers must say which kind
 * of transition they're attempting.
 */
@Injectable()
export class OrderStateMachineService {
  canTransition(from: OrderStatus, to: OrderStatus): boolean {
    return canTransition(from, to);
  }

  isNormalTransition(from: OrderStatus, to: OrderStatus): boolean {
    return isNormalTransition(from, to);
  }

  isAdminOverrideTransition(from: OrderStatus, to: OrderStatus): boolean {
    return isAdminOverrideTransition(from, to);
  }

  /**
   * Use for webhook/vendor/recipient/cron-driven transitions. Throws
   * InvalidOrderTransitionException if `to` is not in `from`'s
   * NORMAL_TRANSITIONS entry — an admin-override edge existing for the same
   * `from`/`to` pair does NOT satisfy this check.
   */
  assertNormalTransition(from: OrderStatus, to: OrderStatus): void {
    if (!this.isNormalTransition(from, to)) {
      throw new InvalidOrderTransitionException(from, to, 'normal');
    }
  }

  /**
   * Use only from an ops/admin-authorized code path (this method does not
   * itself check roles — the caller's guard/controller must). Throws
   * InvalidOrderTransitionException if `to` is not in `from`'s
   * ADMIN_OVERRIDE_TRANSITIONS entry.
   */
  assertAdminOverrideTransition(from: OrderStatus, to: OrderStatus): void {
    if (!this.isAdminOverrideTransition(from, to)) {
      throw new InvalidOrderTransitionException(from, to, 'admin_override');
    }
  }

  /** Read-only introspection — e.g. which buttons an ops UI should show. */
  getAllowedTransitions(from: OrderStatus): ReadonlyArray<OrderStatus> {
    return getAllowedTransitions(from);
  }

  getNormalTransitions(from: OrderStatus): ReadonlyArray<OrderStatus> {
    return NORMAL_TRANSITIONS[from];
  }

  getAdminOverrideTransitions(from: OrderStatus): ReadonlyArray<OrderStatus> {
    return ADMIN_OVERRIDE_TRANSITIONS[from];
  }

  isTerminal(status: OrderStatus): boolean {
    return isTerminal(status);
  }
}
