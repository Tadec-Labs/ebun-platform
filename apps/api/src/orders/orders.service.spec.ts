import { Test } from '@nestjs/testing';
import { OrderStatus } from '@ebun/types';
import { OrdersService } from './orders.service';
import { OrderStateMachineService } from './order-state-machine.service';
import { OrdersRepository } from './orders.repository';
import { InvalidOrderTransitionException } from './exceptions/invalid-order-transition.exception';
import { OrderTransitionConflictException } from './exceptions/order-transition-conflict.exception';

describe('OrdersService', () => {
  let sut: OrdersService;
  let repository: { attemptTransition: jest.Mock };

  beforeEach(async () => {
    repository = { attemptTransition: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        OrdersService,
        OrderStateMachineService, // real instance — pure/cheap, and confirms real wiring rather than assumed behaviour
        { provide: OrdersRepository, useValue: repository },
      ],
    }).compile();

    sut = moduleRef.get(OrdersService);
  });

  describe('transitionNormal', () => {
    it('validates via the real state machine, then writes through the repository with mapped params', async () => {
      repository.attemptTransition.mockResolvedValue({
        id: 'order-1',
        status: OrderStatus.Processing,
      });

      const result = await sut.transitionNormal(
        'order-1',
        OrderStatus.Paid,
        OrderStatus.Processing,
        { type: 'webhook' },
        { paystackReference: 'ref_123' },
      );

      expect(repository.attemptTransition).toHaveBeenCalledWith({
        orderId: 'order-1',
        expectedStatus: OrderStatus.Paid,
        newStatus: OrderStatus.Processing,
        actorType: 'webhook',
        actorId: undefined,
        metadata: { paystackReference: 'ref_123' },
      });
      expect(result).toEqual({ id: 'order-1', status: OrderStatus.Processing });
    });

    it('rejects an illegal transition before ever touching the repository', async () => {
      await expect(
        sut.transitionNormal(
          'order-1',
          OrderStatus.Draft,
          OrderStatus.Fulfilled,
          { type: 'system' },
        ),
      ).rejects.toThrow(InvalidOrderTransitionException);

      expect(repository.attemptTransition).not.toHaveBeenCalled();
    });

    it('surfaces a conflict if the write loses the race, even though the transition was legal', async () => {
      repository.attemptTransition.mockResolvedValue(null);

      await expect(
        sut.transitionNormal(
          'order-1',
          OrderStatus.Paid,
          OrderStatus.Processing,
          { type: 'webhook' },
        ),
      ).rejects.toThrow(OrderTransitionConflictException);
    });
  });

  describe('transitionAdminOverride', () => {
    it('validates via the admin-override table, then writes through the repository', async () => {
      repository.attemptTransition.mockResolvedValue({
        id: 'order-1',
        status: OrderStatus.Refunded,
      });

      const result = await sut.transitionAdminOverride(
        'order-1',
        OrderStatus.Fulfilled,
        OrderStatus.Refunded,
        {
          type: 'admin',
          id: 'admin-user-1',
        },
      );

      expect(repository.attemptTransition).toHaveBeenCalledWith({
        orderId: 'order-1',
        expectedStatus: OrderStatus.Fulfilled,
        newStatus: OrderStatus.Refunded,
        actorType: 'admin',
        actorId: 'admin-user-1',
        metadata: undefined,
      });
      expect(result).toEqual({ id: 'order-1', status: OrderStatus.Refunded });
    });

    it('rejects a normal-pipeline edge attempted as an admin override — the exact separation the split exists for', async () => {
      // draft -> pending_payment is legal NORMALLY, but is not in
      // ADMIN_OVERRIDE_TRANSITIONS for draft.
      await expect(
        sut.transitionAdminOverride(
          'order-1',
          OrderStatus.Draft,
          OrderStatus.PendingPayment,
          { type: 'admin' },
        ),
      ).rejects.toThrow(InvalidOrderTransitionException);

      expect(repository.attemptTransition).not.toHaveBeenCalled();
    });

    it('surfaces a conflict if the write loses the race', async () => {
      repository.attemptTransition.mockResolvedValue(null);

      await expect(
        sut.transitionAdminOverride(
          'order-1',
          OrderStatus.Fulfilled,
          OrderStatus.Refunded,
          { type: 'admin' },
        ),
      ).rejects.toThrow(OrderTransitionConflictException);
    });
  });
});
