import { ConflictException } from '@nestjs/common';
import { OrderStatus } from '@ebun/types';

export class OrderTransitionConflictException extends ConflictException {
  constructor(
    public readonly orderId: string,
    public readonly expectedStatus: OrderStatus,
    public readonly attemptedStatus: OrderStatus,
  ) {
    super(
      `Order ${orderId} could not move from "${expectedStatus}" to "${attemptedStatus}" — ` +
        'it may no longer be in the expected state (concurrent update) or may not exist.',
    );
  }
}
