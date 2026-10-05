import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { OrderStatus } from '@ebun/types';
import { OrdersService } from './orders.service';
import { OrderStateMachineService } from './order-state-machine.service';
import { OrdersRepository } from './orders.repository';
import { InvalidOrderTransitionException } from './exceptions/invalid-order-transition.exception';
import { OrderTransitionConflictException } from './exceptions/order-transition-conflict.exception';

describe('OrdersService', () => {
  let sut: OrdersService;
  let repository: {
    attemptTransition: jest.Mock;
    findConfirmationByPaystackReference: jest.Mock;
  };

  beforeEach(async () => {
    repository = {
      attemptTransition: jest.fn(),
      findConfirmationByPaystackReference: jest.fn(),
    };

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

  describe('getConfirmation', () => {
    it('maps a found order to the coarse public view', async () => {
      repository.findConfirmationByPaystackReference.mockResolvedValue({
        status: OrderStatus.Paid,
        order_number: 'EBN-0042',
        recipient_name: 'Ada',
        reveal_token: 'token-abc',
      });

      const result = await sut.getConfirmation(
        'ebun_ref_1',
        'https://ebun.example',
      );

      expect(
        repository.findConfirmationByPaystackReference,
      ).toHaveBeenCalledWith('ebun_ref_1');
      expect(result).toEqual({
        status: 'confirmed',
        orderNumber: 'EBN-0042',
        recipientName: 'Ada',
        revealUrl: 'https://ebun.example/reveal/token-abc',
      });
    });

    it('reports an unpaid order as awaiting_payment, with no reveal link yet', async () => {
      repository.findConfirmationByPaystackReference.mockResolvedValue({
        status: OrderStatus.PendingPayment,
        order_number: 'EBN-0043',
        recipient_name: 'Chidi',
        reveal_token: 'token-def',
      });

      const result = await sut.getConfirmation(
        'ebun_ref_2',
        'https://ebun.example',
      );

      expect(result.status).toBe('awaiting_payment');
      // Not handed out before payment is actually confirmed — nothing
      // useful to show yet, and no reason to leak a working-looking
      // link early.
      expect(result.revealUrl).toBeNull();
    });

    it('throws NotFoundException for an unknown reference', async () => {
      repository.findConfirmationByPaystackReference.mockResolvedValue(null);

      await expect(
        sut.getConfirmation('nope', 'https://ebun.example'),
      ).rejects.toThrow(NotFoundException);
    });

    it('does not leak raw internal statuses — only the coarse bucket', async () => {
      repository.findConfirmationByPaystackReference.mockResolvedValue({
        status: OrderStatus.VendorDeclined,
        order_number: 'EBN-0044',
        recipient_name: 'Ngozi',
        reveal_token: 'token-ghi',
      });

      const result = await sut.getConfirmation(
        'ebun_ref_3',
        'https://ebun.example',
      );

      expect(Object.keys(result).sort()).toEqual([
        'orderNumber',
        'recipientName',
        'revealUrl',
        'status',
      ]);
      expect(result.status).toBe('confirmed');
    });
  });
});
