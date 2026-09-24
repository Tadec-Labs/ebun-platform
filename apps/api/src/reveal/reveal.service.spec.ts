import { Test } from '@nestjs/testing';
import { FulfillmentType, OrderStatus, RedemptionStatus } from '@ebun/types';
import { RevealService } from './reveal.service';
import { OrdersService } from '../orders/orders.service';
import { OrderRow } from '../orders/orders.repository';
import { GiftsService } from '../gifts/gifts.service';
import { UsersService } from '../users/users.service';
import { RedemptionsService } from '../redemptions/redemptions.service';
import { MEDIA_URL_RESOLVER } from '../media/media-url-resolver.interface';
import { OrderTransitionConflictException } from '../orders/exceptions/order-transition-conflict.exception';

function makeOrder(overrides: Partial<OrderRow> = {}): OrderRow {
  return {
    id: 'order-1',
    status: OrderStatus.ReadyForRedemption,
    order_number: 'EBN-0001',
    total_amount: 500000,
    gift_template_id: 'template-1',
    gift_value: 500000,
    recipient_name: 'Ada',
    recipient_phone: '+2348012345678',
    reveal_token: 'reveal-token-1',
    sender_id: 'sender-1',
    sender_message: null,
    message_type: null,
    message_url: null,
    message_duration_secs: null,
    reveal_theme: 'gold',
    scheduled_send_at: null,
    expires_at: '2099-01-01T00:00:00.000Z', // far future by default
    ...overrides,
  };
}

describe('RevealService', () => {
  let sut: RevealService;
  let orders: { findByRevealToken: jest.Mock; transitionNormal: jest.Mock };
  let gifts: { findById: jest.Mock };
  let users: { findById: jest.Mock };
  let redemptions: {
    createPendingForOrder: jest.Mock;
    complete: jest.Mock;
    findByOrderId: jest.Mock;
  };
  let mediaResolver: { resolvePlaybackUrl: jest.Mock };

  beforeEach(async () => {
    orders = { findByRevealToken: jest.fn(), transitionNormal: jest.fn() };
    gifts = { findById: jest.fn() };
    users = { findById: jest.fn() };
    redemptions = {
      createPendingForOrder: jest.fn(),
      complete: jest.fn(),
      findByOrderId: jest.fn().mockResolvedValue(null),
    };
    mediaResolver = { resolvePlaybackUrl: jest.fn() };

    gifts.findById.mockResolvedValue({
      id: 'template-1',
      name: 'Jollof Rice for Two',
      description: 'A delicious meal',
      image_url: 'https://example.com/img.png',
      delivery_type: FulfillmentType.Vtu,
    });
    users.findById.mockResolvedValue({ id: 'sender-1', name: 'Chidi' });
    orders.transitionNormal.mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        RevealService,
        { provide: OrdersService, useValue: orders },
        { provide: GiftsService, useValue: gifts },
        { provide: UsersService, useValue: users },
        { provide: RedemptionsService, useValue: redemptions },
        { provide: MEDIA_URL_RESOLVER, useValue: mediaResolver },
      ],
    }).compile();

    sut = moduleRef.get(RevealService);
  });

  describe('view', () => {
    it('throws NotFoundException for an unknown token', async () => {
      orders.findByRevealToken.mockResolvedValue(null);

      await expect(sut.view('bad-token')).rejects.toThrow('No gift found');
    });

    it('transitions ready_for_redemption -> reveal_opened on first view and returns gift + sender details', async () => {
      orders.findByRevealToken.mockResolvedValue(
        makeOrder({ status: OrderStatus.ReadyForRedemption }),
      );

      const result = await sut.view('reveal-token-1');

      expect(orders.transitionNormal).toHaveBeenCalledWith(
        'order-1',
        OrderStatus.ReadyForRedemption,
        OrderStatus.RevealOpened,
        { type: 'user' },
      );
      expect(result.viewState).toBe('ready');
      expect(result.giftName).toBe('Jollof Rice for Two');
      expect(result.senderName).toBe('Chidi');
      expect(result.recipientName).toBe('Ada');
    });

    it('also transitions voucher_issued -> reveal_opened on first view', async () => {
      orders.findByRevealToken.mockResolvedValue(
        makeOrder({ status: OrderStatus.VoucherIssued }),
      );

      await sut.view('reveal-token-1');

      expect(orders.transitionNormal).toHaveBeenCalledWith(
        'order-1',
        OrderStatus.VoucherIssued,
        OrderStatus.RevealOpened,
        { type: 'user' },
      );
    });

    it('does not re-transition on a second view — already reveal_opened', async () => {
      orders.findByRevealToken.mockResolvedValue(
        makeOrder({ status: OrderStatus.RevealOpened }),
      );

      const result = await sut.view('reveal-token-1');

      expect(orders.transitionNormal).not.toHaveBeenCalled();
      expect(result.viewState).toBe('ready');
    });

    it('treats a concurrent-request conflict on the reveal transition as success, not an error', async () => {
      orders.findByRevealToken.mockResolvedValue(
        makeOrder({ status: OrderStatus.ReadyForRedemption }),
      );
      orders.transitionNormal.mockRejectedValue(
        new OrderTransitionConflictException(
          'order-1',
          OrderStatus.ReadyForRedemption,
          OrderStatus.RevealOpened,
        ),
      );

      const result = await sut.view('reveal-token-1');

      expect(result.viewState).toBe('ready');
    });

    it('propagates a genuinely unexpected error from the transition attempt', async () => {
      orders.findByRevealToken.mockResolvedValue(
        makeOrder({ status: OrderStatus.ReadyForRedemption }),
      );
      orders.transitionNormal.mockRejectedValue(new Error('DB is on fire'));

      await expect(sut.view('reveal-token-1')).rejects.toThrow('DB is on fire');
    });

    it('treats an order past expires_at as expired regardless of what status currently says (no cron has swept it yet)', async () => {
      orders.findByRevealToken.mockResolvedValue(
        makeOrder({
          status: OrderStatus.ReadyForRedemption, // status hasn't caught up
          expires_at: '2020-01-01T00:00:00.000Z', // long past
        }),
      );

      const result = await sut.view('reveal-token-1');

      expect(result.viewState).toBe('expired');
      expect(orders.transitionNormal).not.toHaveBeenCalled();
      // Minimal payload — no gift/sender details leaked for an expired link.
      expect(result.giftName).toBeUndefined();
    });

    it('does not treat an already-redeemed order as expired even if past expires_at', async () => {
      orders.findByRevealToken.mockResolvedValue(
        makeOrder({
          status: OrderStatus.Redeemed,
          expires_at: '2020-01-01T00:00:00.000Z',
        }),
      );

      const result = await sut.view('reveal-token-1');

      expect(result.viewState).toBe('ready');
    });

    it('returns "unavailable" for a cancelled/refunded/failed order', async () => {
      orders.findByRevealToken.mockResolvedValue(
        makeOrder({ status: OrderStatus.Cancelled }),
      );

      const result = await sut.view('reveal-token-1');

      expect(result.viewState).toBe('unavailable');
      expect(result.giftName).toBeUndefined();
    });

    it('returns "not_ready" for an order still mid-fulfillment', async () => {
      orders.findByRevealToken.mockResolvedValue(
        makeOrder({ status: OrderStatus.FulfillmentInProgress }),
      );

      const result = await sut.view('reveal-token-1');

      expect(result.viewState).toBe('not_ready');
      expect(result.giftName).toBeUndefined();
    });

    it('resolves a private playback URL for a video message rather than returning message_url raw', async () => {
      mediaResolver.resolvePlaybackUrl.mockResolvedValue(
        'https://cdn.example.com/signed/video.mp4',
      );
      orders.findByRevealToken.mockResolvedValue(
        makeOrder({
          message_type: 'video',
          message_url: 'private/bucket/path.mp4',
          message_duration_secs: 12,
        }),
      );

      const result = await sut.view('reveal-token-1');

      expect(mediaResolver.resolvePlaybackUrl).toHaveBeenCalledWith(
        'private/bucket/path.mp4',
      );
      expect(result.message).toEqual({
        type: 'video',
        text: null,
        durationSecs: 12,
        playbackUrl: 'https://cdn.example.com/signed/video.mp4',
      });
    });

    it('does not call the media resolver for a text message', async () => {
      orders.findByRevealToken.mockResolvedValue(
        makeOrder({ message_type: 'text', sender_message: 'Happy birthday!' }),
      );

      const result = await sut.view('reveal-token-1');

      expect(mediaResolver.resolvePlaybackUrl).not.toHaveBeenCalled();
      expect(result.message).toEqual({ type: 'text', text: 'Happy birthday!' });
    });

    it('always includes fulfillmentType, from the gift template', async () => {
      orders.findByRevealToken.mockResolvedValue(
        makeOrder({ status: OrderStatus.RevealOpened }),
      );

      const result = await sut.view('reveal-token-1'); // default mock gift is Vtu

      expect(result.fulfillmentType).toBe(FulfillmentType.Vtu);
    });

    it('includes the redemption code/QR for a digital_voucher order with a pending redemption', async () => {
      orders.findByRevealToken.mockResolvedValue(
        makeOrder({ status: OrderStatus.RevealOpened }),
      );
      gifts.findById.mockResolvedValue({
        id: 'template-1',
        name: 'Voucher',
        description: null,
        image_url: null,
        delivery_type: FulfillmentType.DigitalVoucher,
      });
      redemptions.findByOrderId.mockResolvedValue({
        status: RedemptionStatus.Pending,
        fallback_code: 'EBN-7K2-9XQ',
        redemption_token: 'redemption-token-1',
      });

      const result = await sut.view('reveal-token-1');

      expect(redemptions.findByOrderId).toHaveBeenCalledWith('order-1');
      expect(result.redemption).toEqual({
        status: RedemptionStatus.Pending,
        fallbackCode: 'EBN-7K2-9XQ',
        qrPayload: 'redemption-token-1',
      });
    });

    it('does not look up a redemption at all for a non-digital_voucher gift', async () => {
      orders.findByRevealToken.mockResolvedValue(
        makeOrder({ status: OrderStatus.RevealOpened }),
      ); // default mock gift is Vtu

      await sut.view('reveal-token-1');

      expect(redemptions.findByOrderId).not.toHaveBeenCalled();
    });

    it('omits redemption for a digital_voucher order with none created yet', async () => {
      orders.findByRevealToken.mockResolvedValue(
        makeOrder({ status: OrderStatus.RevealOpened }),
      );
      gifts.findById.mockResolvedValue({
        id: 'template-1',
        name: 'Voucher',
        description: null,
        image_url: null,
        delivery_type: FulfillmentType.DigitalVoucher,
      });
      redemptions.findByOrderId.mockResolvedValue(null);

      const result = await sut.view('reveal-token-1');

      expect(result.redemption).toBeUndefined();
    });

    it('omits redemption once completed, even if the order status is lagging behind at reveal_opened', async () => {
      // Documents the exact edge case RedemptionsService.complete() flags:
      // the redemption itself completes atomically, but the order's own
      // status transition to `redeemed` is best-effort and can fail
      // separately, leaving order.status stuck at reveal_opened. A
      // completed redemption is the terminal "redeemed" state either
      // way — not a code to keep showing.
      orders.findByRevealToken.mockResolvedValue(
        makeOrder({ status: OrderStatus.RevealOpened }),
      );
      gifts.findById.mockResolvedValue({
        id: 'template-1',
        name: 'Voucher',
        description: null,
        image_url: null,
        delivery_type: FulfillmentType.DigitalVoucher,
      });
      redemptions.findByOrderId.mockResolvedValue({
        status: RedemptionStatus.Completed,
        fallback_code: 'EBN-7K2-9XQ',
        redemption_token: 'redemption-token-1',
      });

      const result = await sut.view('reveal-token-1');

      expect(result.redemption).toBeUndefined();
    });
  });

  describe('acceptGift', () => {
    it('auto-completes the redemption for a vtu gift with no vendor step to wait for', async () => {
      orders.findByRevealToken.mockResolvedValue(
        makeOrder({ status: OrderStatus.RevealOpened }),
      );
      redemptions.createPendingForOrder.mockResolvedValue({
        redemption_token: 'redemption-token-1',
      });
      gifts.findById.mockResolvedValue({
        id: 'template-1',
        name: 'Airtime',
        description: null,
        image_url: null,
        delivery_type: FulfillmentType.Vtu,
      });

      await sut.acceptGift('reveal-token-1');

      expect(redemptions.createPendingForOrder).toHaveBeenCalledWith(
        'order-1',
        '2099-01-01T00:00:00.000Z',
      );
      expect(redemptions.complete).toHaveBeenCalledWith({
        redemptionToken: 'redemption-token-1',
        vendorId: null,
        vendorConfirmedBy: null,
        ipAddress: null,
        userAgent: null,
        actorType: 'system',
      });
    });

    it('does NOT auto-complete for a digital_voucher gift — leaves it pending for a real vendor scan, and returns its code/QR', async () => {
      orders.findByRevealToken.mockResolvedValue(
        makeOrder({ status: OrderStatus.RevealOpened }),
      );
      redemptions.createPendingForOrder.mockResolvedValue({
        redemption_token: 'redemption-token-1',
      });
      gifts.findById.mockResolvedValue({
        id: 'template-1',
        name: 'Voucher',
        description: null,
        image_url: null,
        delivery_type: FulfillmentType.DigitalVoucher,
      });
      // Stands in for view()'s own findByOrderId lookup seeing the row
      // createPendingForOrder just created — separate mocks because
      // this is a fake repository, not a real DB the two calls share.
      redemptions.findByOrderId.mockResolvedValue({
        status: RedemptionStatus.Pending,
        fallback_code: 'EBN-7K2-9XQ',
        redemption_token: 'redemption-token-1',
      });

      const result = await sut.acceptGift('reveal-token-1');

      expect(redemptions.complete).not.toHaveBeenCalled();
      expect(result.redemption).toEqual({
        status: RedemptionStatus.Pending,
        fallbackCode: 'EBN-7K2-9XQ',
        qrPayload: 'redemption-token-1',
      });
    });

    it('implicitly performs the reveal transition if accept is called before any GET', async () => {
      orders.findByRevealToken.mockResolvedValue(
        makeOrder({ status: OrderStatus.ReadyForRedemption }),
      );
      redemptions.createPendingForOrder.mockResolvedValue({
        redemption_token: 'redemption-token-1',
      });

      await sut.acceptGift('reveal-token-1');

      expect(orders.transitionNormal).toHaveBeenCalledWith(
        'order-1',
        OrderStatus.ReadyForRedemption,
        OrderStatus.RevealOpened,
        { type: 'user' },
      );
      expect(redemptions.createPendingForOrder).toHaveBeenCalled();
    });

    it('is a no-op (just returns current view) if the gift is already redeemed', async () => {
      orders.findByRevealToken.mockResolvedValue(
        makeOrder({ status: OrderStatus.Redeemed }),
      );

      const result = await sut.acceptGift('reveal-token-1');

      expect(redemptions.createPendingForOrder).not.toHaveBeenCalled();
      expect(result.viewState).toBe('ready');
    });
  });
});
