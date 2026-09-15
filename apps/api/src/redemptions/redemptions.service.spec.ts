import { Test } from '@nestjs/testing';
import { OrderStatus } from '@ebun/types';
import { RedemptionsService } from './redemptions.service';
import { RedemptionsRepository } from './redemptions.repository';
import { OrdersService } from '../orders/orders.service';
import { RedemptionConflictException } from './exceptions/redemption-conflict.exception';

describe('RedemptionsService', () => {
  let sut: RedemptionsService;
  let repository: {
    createPendingOrFetch: jest.Mock;
    attemptRedemption: jest.Mock;
  };
  let ordersService: { transitionNormal: jest.Mock };

  beforeEach(async () => {
    repository = {
      createPendingOrFetch: jest.fn(),
      attemptRedemption: jest.fn(),
    };
    ordersService = {
      transitionNormal: jest.fn().mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        RedemptionsService,
        { provide: RedemptionsRepository, useValue: repository },
        { provide: OrdersService, useValue: ordersService },
      ],
    }).compile();

    sut = moduleRef.get(RedemptionsService);
  });

  describe('createPendingForOrder', () => {
    it('delegates straight to the repository', async () => {
      repository.createPendingOrFetch.mockResolvedValue({ id: 'redemption-1' });

      const result = await sut.createPendingForOrder(
        'order-1',
        '2026-10-06T00:00:00.000Z',
      );

      expect(repository.createPendingOrFetch).toHaveBeenCalledWith(
        'order-1',
        '2026-10-06T00:00:00.000Z',
      );
      expect(result).toEqual({ id: 'redemption-1' });
    });
  });

  describe('complete', () => {
    const params = {
      redemptionToken: 'token-1',
      vendorId: 'vendor-1',
      vendorConfirmedBy: 'Staff Name',
      ipAddress: '127.0.0.1',
      userAgent: 'test-agent',
      actorType: 'vendor' as const,
    };

    it('throws RedemptionConflictException when attempt_redemption returns null (unknown/already-used/expired token)', async () => {
      repository.attemptRedemption.mockResolvedValue(null);

      await expect(sut.complete(params)).rejects.toThrow(
        RedemptionConflictException,
      );
      expect(ordersService.transitionNormal).not.toHaveBeenCalled();
    });

    it('transitions the order to redeemed after a successful completion', async () => {
      repository.attemptRedemption.mockResolvedValue({
        id: 'redemption-1',
        order_id: 'order-1',
        status: 'completed',
      });

      const result = await sut.complete(params);

      expect(ordersService.transitionNormal).toHaveBeenCalledWith(
        'order-1',
        OrderStatus.RevealOpened,
        OrderStatus.Redeemed,
        { type: 'vendor' },
      );
      expect(result).toEqual({
        id: 'redemption-1',
        order_id: 'order-1',
        status: 'completed',
      });
    });

    it('still returns the completed redemption even if the order status transition fails — the redemption itself is already correctly, permanently completed', async () => {
      repository.attemptRedemption.mockResolvedValue({
        id: 'redemption-1',
        order_id: 'order-1',
        status: 'completed',
      });
      ordersService.transitionNormal.mockRejectedValue(
        new Error('order already moved on somehow'),
      );

      await expect(sut.complete(params)).resolves.toEqual({
        id: 'redemption-1',
        order_id: 'order-1',
        status: 'completed',
      });
    });

    it('uses actorType "system" for a vendorless (VTU) completion', async () => {
      repository.attemptRedemption.mockResolvedValue({
        id: 'redemption-1',
        order_id: 'order-1',
        status: 'completed',
      });

      await sut.complete({
        redemptionToken: 'token-1',
        vendorId: null,
        vendorConfirmedBy: null,
        ipAddress: null,
        userAgent: null,
        actorType: 'system',
      });

      expect(ordersService.transitionNormal).toHaveBeenCalledWith(
        'order-1',
        OrderStatus.RevealOpened,
        OrderStatus.Redeemed,
        { type: 'system' },
      );
    });
  });
});
