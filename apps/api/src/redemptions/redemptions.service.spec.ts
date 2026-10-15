import { AutoPayoutsService } from '../payouts/auto-payouts.service';
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
    findByOrderId: jest.Mock;
    vendorPayoutFor: jest.Mock;
    recordVendorCredit: jest.Mock;
  };
  let ordersService: { transitionNormal: jest.Mock };

  let autoPayouts: { payVendorSoon: jest.Mock };
  beforeEach(async () => {
    repository = {
      createPendingOrFetch: jest.fn(),
      attemptRedemption: jest.fn(),
      findByOrderId: jest.fn(),
      // ₦7,200: the vendor's agreed price on a ₦8,000 gift at a 90% share
      vendorPayoutFor: jest.fn().mockResolvedValue(720000),
      recordVendorCredit: jest.fn().mockResolvedValue(undefined),
    };
    ordersService = {
      transitionNormal: jest.fn().mockResolvedValue(undefined),
    };
    autoPayouts = { payVendorSoon: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        RedemptionsService,
        { provide: RedemptionsRepository, useValue: repository },
        { provide: OrdersService, useValue: ordersService },
        { provide: AutoPayoutsService, useValue: autoPayouts },
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

  describe('findByOrderId', () => {
    it('delegates straight to the repository and does not create anything', async () => {
      repository.findByOrderId.mockResolvedValue({ id: 'redemption-1' });

      const result = await sut.findByOrderId('order-1');

      expect(repository.findByOrderId).toHaveBeenCalledWith('order-1');
      expect(repository.createPendingOrFetch).not.toHaveBeenCalled();
      expect(result).toEqual({ id: 'redemption-1' });
    });

    it('returns null when no redemption exists yet for the order', async () => {
      repository.findByOrderId.mockResolvedValue(null);

      const result = await sut.findByOrderId('order-1');

      expect(result).toBeNull();
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
        { vendorId: 'vendor-1', vendorPayoutAmount: 720000 },
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

    it('credits the collecting vendor with their agreed price on the order', async () => {
      repository.attemptRedemption.mockResolvedValue({
        id: 'redemption-1',
        order_id: 'order-1',
        status: 'completed',
      });

      await sut.complete(params);

      expect(repository.vendorPayoutFor).toHaveBeenCalledWith(
        'order-1',
        'vendor-1',
      );
      expect(repository.recordVendorCredit).toHaveBeenCalledWith(
        'order-1',
        'vendor-1',
        720000,
      );
    });

    it('records no credit, and still completes, when the vendor has no price for the gift', async () => {
      repository.attemptRedemption.mockResolvedValue({
        id: 'redemption-1',
        order_id: 'order-1',
        status: 'completed',
      });
      repository.vendorPayoutFor.mockResolvedValue(null);

      await expect(sut.complete(params)).resolves.toMatchObject({
        id: 'redemption-1',
      });
      expect(repository.recordVendorCredit).not.toHaveBeenCalled();
      expect(ordersService.transitionNormal).toHaveBeenCalledWith(
        'order-1',
        OrderStatus.RevealOpened,
        OrderStatus.Redeemed,
        { type: 'vendor' },
        undefined,
      );
    });

    it('still completes when writing the credit fails — the amount is on the audit event', async () => {
      repository.attemptRedemption.mockResolvedValue({
        id: 'redemption-1',
        order_id: 'order-1',
        status: 'completed',
      });
      repository.recordVendorCredit.mockRejectedValue(new Error('db down'));

      await expect(sut.complete(params)).resolves.toMatchObject({
        id: 'redemption-1',
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
        undefined,
      );
      expect(repository.vendorPayoutFor).not.toHaveBeenCalled();
      expect(repository.recordVendorCredit).not.toHaveBeenCalled();
    });
  });
});
