import { Test } from '@nestjs/testing';
import { NotFoundException, NotImplementedException } from '@nestjs/common';
import { FulfillmentStatus, FulfillmentType, OrderStatus } from '@ebun/types';
import { FulfillmentOrchestratorService } from './fulfillment-orchestrator.service';
import { OrdersService } from '../orders/orders.service';
import { OrderRow } from '../orders/orders.repository';
import { GiftsService } from '../gifts/gifts.service';
import { GiftFulfillmentsRepository } from './gift-fulfillments.repository';
import { DigitalVoucherService } from './digital-voucher.service';
import { NotificationsService } from '../notifications/notifications.service';
import { VTU_PROVIDER } from './vtu-provider.interface';
import { UnsupportedFulfillmentTypeException } from './exceptions/unsupported-fulfillment-type.exception';

function makeOrder(overrides: Partial<OrderRow> = {}): OrderRow {
  return {
    id: 'order-1',
    status: OrderStatus.Paid,
    order_number: 'EBN-0001',
    total_amount: 500000,
    gift_template_id: 'template-1',
    gift_value: 500000,
    recipient_name: 'Recipient Name',
    recipient_phone: '+2348012345678',
    reveal_token: 'reveal-token-1',
    sender_id: 'sender-1',
    sender_message: null,
    message_type: null,
    message_url: null,
    message_duration_secs: null,
    reveal_theme: 'gold',
    scheduled_send_at: null,
    expires_at: '2026-10-06T00:00:00.000Z',
    ...overrides,
  };
}

describe('FulfillmentOrchestratorService', () => {
  let sut: FulfillmentOrchestratorService;
  let orders: { findById: jest.Mock; transitionNormal: jest.Mock };
  let gifts: { findById: jest.Mock };
  let fulfillments: {
    create: jest.Mock;
    markVoucherIssued: jest.Mock;
    markVtuProcessing: jest.Mock;
    markVtuComplete: jest.Mock;
  };
  let digitalVoucher: { generateCode: jest.Mock };
  let vtuProvider: { topUp: jest.Mock };
  let notifications: { sendGiftRevealLink: jest.Mock };

  beforeEach(async () => {
    orders = { findById: jest.fn(), transitionNormal: jest.fn() };
    gifts = { findById: jest.fn() };
    fulfillments = {
      create: jest.fn(),
      markVoucherIssued: jest.fn(),
      markVtuProcessing: jest.fn(),
      markVtuComplete: jest.fn(),
    };
    digitalVoucher = { generateCode: jest.fn() };
    vtuProvider = { topUp: jest.fn() };
    notifications = {
      sendGiftRevealLink: jest.fn().mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        FulfillmentOrchestratorService,
        { provide: OrdersService, useValue: orders },
        { provide: GiftsService, useValue: gifts },
        { provide: GiftFulfillmentsRepository, useValue: fulfillments },
        { provide: DigitalVoucherService, useValue: digitalVoucher },
        { provide: NotificationsService, useValue: notifications },
        { provide: VTU_PROVIDER, useValue: vtuProvider },
      ],
    }).compile();

    sut = moduleRef.get(FulfillmentOrchestratorService);

    orders.findById.mockResolvedValue(makeOrder());
    orders.transitionNormal.mockResolvedValue(undefined);
    fulfillments.create.mockResolvedValue({ id: 'fulfillment-1' });
    fulfillments.markVoucherIssued.mockResolvedValue(undefined);
    fulfillments.markVtuProcessing.mockResolvedValue(undefined);
    fulfillments.markVtuComplete.mockResolvedValue(undefined);
  });

  describe('digital_voucher', () => {
    beforeEach(() => {
      gifts.findById.mockResolvedValue({
        id: 'template-1',
        delivery_type: FulfillmentType.DigitalVoucher,
      });
      digitalVoucher.generateCode.mockReturnValue('EBN-VCH-DEADBEEF01234567');
    });

    it('walks paid -> processing -> fulfillment_in_progress -> voucher_issued', async () => {
      await sut.start('order-1');

      expect(orders.transitionNormal).toHaveBeenNthCalledWith(
        1,
        'order-1',
        OrderStatus.Paid,
        OrderStatus.Processing,
        { type: 'system' },
      );
      expect(orders.transitionNormal).toHaveBeenNthCalledWith(
        2,
        'order-1',
        OrderStatus.Processing,
        OrderStatus.FulfillmentInProgress,
        { type: 'system' },
      );
      expect(orders.transitionNormal).toHaveBeenNthCalledWith(
        3,
        'order-1',
        OrderStatus.FulfillmentInProgress,
        OrderStatus.VoucherIssued,
        { type: 'system' },
      );
      expect(orders.transitionNormal).toHaveBeenCalledTimes(3);
    });

    it('creates the gift_fulfillments row before generating the code', async () => {
      const callOrder: string[] = [];
      fulfillments.create.mockImplementation(() => {
        callOrder.push('create');
        return Promise.resolve({ id: 'fulfillment-1' });
      });
      digitalVoucher.generateCode.mockImplementation(() => {
        callOrder.push('generateCode');
        return 'EBN-VCH-DEADBEEF01234567';
      });

      await sut.start('order-1');

      expect(callOrder).toEqual(['create', 'generateCode']);
      expect(fulfillments.create).toHaveBeenCalledWith({
        orderId: 'order-1',
        fulfillmentType: FulfillmentType.DigitalVoucher,
        status: FulfillmentStatus.InProgress,
      });
    });

    it('mirrors voucher_valid_until onto the order expiry (INFERRED, no schema mandate)', async () => {
      await sut.start('order-1');

      expect(fulfillments.markVoucherIssued).toHaveBeenCalledWith('order-1', {
        voucherCode: 'EBN-VCH-DEADBEEF01234567',
        voucherValidUntil: '2026-10-06T00:00:00.000Z',
      });
    });

    it('never touches the VTU provider', async () => {
      await sut.start('order-1');
      expect(vtuProvider.topUp).not.toHaveBeenCalled();
    });

    it('sends the gift reveal notification after voucher_issued', async () => {
      const order = makeOrder();
      orders.findById.mockResolvedValue(order);

      await sut.start('order-1');

      expect(notifications.sendGiftRevealLink).toHaveBeenCalledWith(order);
    });

    it('does not let a notification failure propagate out of start()', async () => {
      notifications.sendGiftRevealLink.mockRejectedValue(
        new Error('Termii is down'),
      );

      await expect(sut.start('order-1')).resolves.toBeUndefined();
    });
  });

  describe('vtu', () => {
    beforeEach(() => {
      gifts.findById.mockResolvedValue({
        id: 'template-1',
        delivery_type: FulfillmentType.Vtu,
      });
      vtuProvider.topUp.mockResolvedValue({
        providerTransactionId: 'provider-tx-1',
      });
    });

    it('walks paid -> processing -> fulfillment_in_progress -> ready_for_redemption', async () => {
      await sut.start('order-1');

      expect(orders.transitionNormal).toHaveBeenNthCalledWith(
        1,
        'order-1',
        OrderStatus.Paid,
        OrderStatus.Processing,
        { type: 'system' },
      );
      expect(orders.transitionNormal).toHaveBeenNthCalledWith(
        2,
        'order-1',
        OrderStatus.Processing,
        OrderStatus.FulfillmentInProgress,
        { type: 'system' },
      );
      expect(orders.transitionNormal).toHaveBeenNthCalledWith(
        3,
        'order-1',
        OrderStatus.FulfillmentInProgress,
        OrderStatus.ReadyForRedemption,
        { type: 'system' },
      );
    });

    it('persists a vtu_request_id BEFORE calling the provider, and tops up the frozen gift_value not total_amount', async () => {
      const callOrder: string[] = [];
      fulfillments.create.mockImplementation(() => {
        callOrder.push('create');
        return Promise.resolve({ id: 'fulfillment-1' });
      });
      fulfillments.markVtuProcessing.mockImplementation(() => {
        callOrder.push('markVtuProcessing');
        return Promise.resolve(undefined);
      });
      vtuProvider.topUp.mockImplementation(() => {
        callOrder.push('topUp');
        return Promise.resolve({ providerTransactionId: 'provider-tx-1' });
      });

      await sut.start('order-1');

      expect(callOrder).toEqual(['create', 'markVtuProcessing', 'topUp']);

      interface CapturedCreateCall {
        orderId: string;
        fulfillmentType: FulfillmentType;
        status: FulfillmentStatus;
        vtuPhoneNumber: string;
        vtuRequestId: string;
      }
      const calls = fulfillments.create.mock
        .calls as unknown as CapturedCreateCall[][];
      const createCall = calls[0][0];
      expect(createCall).toMatchObject({
        orderId: 'order-1',
        fulfillmentType: FulfillmentType.Vtu,
        status: FulfillmentStatus.Pending,
        vtuPhoneNumber: '+2348012345678',
      });
      expect(typeof createCall.vtuRequestId).toBe('string');
      expect(createCall.vtuRequestId.length).toBeGreaterThan(0);

      expect(vtuProvider.topUp).toHaveBeenCalledWith({
        requestId: createCall.vtuRequestId,
        phoneNumber: '+2348012345678',
        amountKobo: 500000, // gift_value, not total_amount
      });
    });

    it('records the provider transaction id on success', async () => {
      await sut.start('order-1');

      expect(fulfillments.markVtuComplete).toHaveBeenCalledWith('order-1', {
        providerTransactionId: 'provider-tx-1',
      });
    });

    it('sends the gift reveal notification after ready_for_redemption', async () => {
      const order = makeOrder();
      orders.findById.mockResolvedValue(order);

      await sut.start('order-1');

      expect(notifications.sendGiftRevealLink).toHaveBeenCalledWith(order);
    });

    it('propagates a provider failure and leaves the order at fulfillment_in_progress', async () => {
      vtuProvider.topUp.mockRejectedValue(
        new NotImplementedException('VTU provider not built yet'),
      );

      await expect(sut.start('order-1')).rejects.toThrow(
        'VTU provider not built yet',
      );

      expect(fulfillments.markVtuComplete).not.toHaveBeenCalled();
      // Only 2 transitions happened (to processing, to fulfillment_in_progress) — never reached ready_for_redemption.
      expect(orders.transitionNormal).toHaveBeenCalledTimes(2);
      // Never reached the point of notifying — the gift was never actually made ready.
      expect(notifications.sendGiftRevealLink).not.toHaveBeenCalled();
    });
  });

  describe('unsupported fulfillment types', () => {
    it.each([FulfillmentType.Physical, FulfillmentType.Experience])(
      'throws for %s and leaves the order at processing',
      async (deliveryType) => {
        gifts.findById.mockResolvedValue({
          id: 'template-1',
          delivery_type: deliveryType,
        });

        await expect(sut.start('order-1')).rejects.toThrow(
          UnsupportedFulfillmentTypeException,
        );

        // Only the paid -> processing transition happened.
        expect(orders.transitionNormal).toHaveBeenCalledTimes(1);
        expect(fulfillments.create).not.toHaveBeenCalled();
      },
    );
  });

  it('throws NotFoundException and touches nothing else if the order does not exist', async () => {
    orders.findById.mockResolvedValue(null);

    await expect(sut.start('missing-order')).rejects.toThrow(NotFoundException);

    expect(gifts.findById).not.toHaveBeenCalled();
    expect(orders.transitionNormal).not.toHaveBeenCalled();
  });

  it('looks up the gift template without the .available check (findById, not findAvailableById)', async () => {
    gifts.findById.mockResolvedValue({
      id: 'template-1',
      delivery_type: FulfillmentType.DigitalVoucher,
    });
    digitalVoucher.generateCode.mockReturnValue('EBN-VCH-DEADBEEF01234567');

    await sut.start('order-1');

    expect(gifts.findById).toHaveBeenCalledWith('template-1');
  });
});
