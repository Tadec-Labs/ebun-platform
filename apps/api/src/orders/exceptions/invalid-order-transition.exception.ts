import { BadRequestException } from '@nestjs/common';
import { OrderStatus } from '@ebun/types';

export type OrderTransitionKind = 'normal' | 'admin_override';

/**
 * Thrown by OrderStateMachineService when a transition is attempted that
 * isn't legal for the kind of caller attempting it (normal pipeline vs
 * admin override — these are checked independently, see
 * order-state-machine.ts). Extends BadRequestException so it maps to a 400
 * automatically if it ever bubbles up to a controller unhandled, and carries
 * `from`/`to`/`attemptedAs` as structured fields for audit_events logging.
 */
export class InvalidOrderTransitionException extends BadRequestException {
  constructor(
    public readonly from: OrderStatus,
    public readonly to: OrderStatus,
    public readonly attemptedAs: OrderTransitionKind,
  ) {
    super(
      `Cannot transition order from "${from}" to "${to}" as a ${attemptedAs} transition`,
    );
  }
}
