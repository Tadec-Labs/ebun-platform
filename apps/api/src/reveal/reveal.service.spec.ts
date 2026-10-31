import { Test } from '@nestjs/testing';
import { FulfillmentType, OrderStatus, RedemptionStatus } from '@ebun/types';
import { RevealService } from './reveal.service';
import { OrdersService } from '../orders/orders.service';
import { OrderRow } from '../orders/orders.repository';
import { GiftsService } from '../gifts/gifts.service';
import { UsersService } from '../users/users.service';
import { RedemptionsService } from '../redemptions/redemptions.service';
import { VendorsService } from '../vendors/vendors.service';
import { AuditService } from '../audit/audit.service';
import { MEDIA_URL_RESOLVER } from '../media/media-url-resolver.interface';
import { OrderTransitionConflictException } from '../orders/exceptions/order-transition-conflict.exception';
import { DeliveriesService } from '../deliveries/deliveries.service';
import { VendorAlertsService } from '../alerts/vendor-alerts.service';
import { CampaignGiftsService } from '../corporate/campaign-gifts.service';
import { GroupGiftsService } from '../group-gifts/group-gifts.service';

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
  let orders: {
    findByRevealToken: jest.Mock;
    transitionNormal: jest.Mock;
    recordPickup: jest.Mock;
  };
  let audit: { record: jest.Mock };
  let gifts: { findById: jest.Mock };
  let users: { findById: jest.Mock };
  let redemptions: {
    createPendingForOrder: jest.Mock;
    complete: jest.Mock;
    findByOrderId: jest.Mock;
  };
  let mediaResolver: { resolvePlaybackUrl: jest.Mock };
  let vendors: { collectionPointsForGift: jest.Mock; publicNameOf: jest.Mock };
  let alerts: { newPickup: jest.Mock };
  let deliveries: {
    forRecipient: jest.Mock;
    setRecipientDetails: jest.Mock;
    markOpened: jest.Mock;
  };
  let groupGifts: { revealInfo: jest.Mock };
  let campaignGifts: {
    revealInfo: jest.Mock;
    choose: jest.Mock;
    thank: jest.Mock;
  };

  beforeEach(async () => {
    orders = {
      findByRevealToken: jest.fn(),
      transitionNormal: jest.fn(),
      recordPickup: jest.fn().mockResolvedValue(true),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    gifts = { findById: jest.fn() };
    users = { findById: jest.fn() };
    redemptions = {
      createPendingForOrder: jest.fn(),
      complete: jest.fn(),
      findByOrderId: jest.fn().mockResolvedValue(null),
    };
    mediaResolver = { resolvePlaybackUrl: jest.fn() };
    vendors = {
      collectionPointsForGift: jest.fn().mockResolvedValue([]),
      publicNameOf: jest.fn().mockResolvedValue(null),
    };

    alerts = { newPickup: jest.fn().mockResolvedValue(undefined) };
    deliveries = {
      forRecipient: jest.fn().mockResolvedValue({ stage: 'awaiting_address' }),
      setRecipientDetails: jest.fn().mockResolvedValue(undefined),
      markOpened: jest.fn().mockResolvedValue(undefined),
    };

    groupGifts = { revealInfo: jest.fn().mockResolvedValue(null) };

    campaignGifts = {
      revealInfo: jest.fn().mockResolvedValue(null),
      choose: jest.fn().mockResolvedValue(undefined),
      thank: jest.fn().mockResolvedValue(undefined),
    };

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
        { provide: VendorsService, useValue: vendors },
        { provide: AuditService, useValue: audit },
        { provide: DeliveriesService, useValue: deliveries },
        { provide: VendorAlertsService, useValue: alerts },
        { provide: MEDIA_URL_RESOLVER, useValue: mediaResolver },
        { provide: CampaignGiftsService, useValue: campaignGifts },
        { provide: GroupGiftsService, useValue: groupGifts },
      ],
    }).compile();

    sut = moduleRef.get(RevealService);
  });

  describe('company campaign gifts', () => {
    const info = {
      companyName: 'Acme Ltd',
      senderDisplayName: 'Ada Obi, CEO',
      title: 'Thank you for 2026',
      thanked: false,
      choices: [
        {
          giftTemplateId: 'template-1',
          name: 'Lunch for two',
          description: null,
          imageUrl: null,
          deliveryType: 'digital_voucher',
        },
        {
          giftTemplateId: 'template-2',
          name: 'Spa morning',
          description: null,
          imageUrl: null,
          deliveryType: 'digital_voucher',
        },
      ],
    };

    it('asks the recipient to choose before anything else exists', async () => {
      orders.findByRevealToken.mockResolvedValue(
        makeOrder({
          status: OrderStatus.Paid,
          campaign_id: 'campaign-1',
          gift_chosen_at: null,
          sender_id: null,
        }),
      );
      campaignGifts.revealInfo.mockResolvedValue(info);

      const view = await sut.view('token');

      expect(view.viewState).toBe('choose');
      expect(view.senderName).toBe('Ada Obi, CEO');
      expect(view.company?.choices).toHaveLength(2);
      // Nothing about a gift that hasn't been chosen.
      expect(view.giftName).toBeUndefined();
      expect(orders.transitionNormal).not.toHaveBeenCalled();
    });

    it('shows an unchosen gift past its date as expired, not as a choice', async () => {
      orders.findByRevealToken.mockResolvedValue(
        makeOrder({
          status: OrderStatus.Paid,
          campaign_id: 'campaign-1',
          gift_chosen_at: null,
          expires_at: new Date(Date.now() - 1000).toISOString(),
        }),
      );

      expect((await sut.view('token')).viewState).toBe('expired');
      expect(campaignGifts.revealInfo).not.toHaveBeenCalled();
    });

    it('records the choice, then serves the fulfilled gift', async () => {
      orders.findByRevealToken
        .mockResolvedValueOnce(
          makeOrder({ status: OrderStatus.Paid, campaign_id: 'campaign-1' }),
        )
        .mockResolvedValueOnce(
          makeOrder({
            status: OrderStatus.ReadyForRedemption,
            campaign_id: 'campaign-1',
            gift_chosen_at: '2026-10-16T09:00:00Z',
          }),
        );
      campaignGifts.revealInfo.mockResolvedValue({ ...info, choices: null });

      const view = await sut.chooseGift('token', 'template-2');

      expect(campaignGifts.choose).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'order-1' }),
        'template-2',
      );
      expect(view.viewState).toBe('ready');
      expect(view.company).toEqual({
        companyName: 'Acme Ltd',
        title: 'Thank you for 2026',
        thanked: false,
      });
      expect(view.senderName).toBe('Ada Obi, CEO');
    });

    it('refuses a choice after the gift has expired', async () => {
      orders.findByRevealToken.mockResolvedValue(
        makeOrder({
          status: OrderStatus.Paid,
          campaign_id: 'campaign-1',
          expires_at: new Date(Date.now() - 1000).toISOString(),
        }),
      );

      const view = await sut.chooseGift('token', 'template-2');

      expect(view.viewState).toBe('expired');
      expect(campaignGifts.choose).not.toHaveBeenCalled();
    });
  });

  describe('doorstep (physical) gifts', () => {
    beforeEach(() => {
      gifts.findById.mockResolvedValue({
        id: 'template-1',
        name: 'Grocery Hamper',
        description: null,
        image_url: null,
        delivery_type: FulfillmentType.Physical,
      });
    });

    it('is viewable as soon as it is paid for, with the delivery and no message yet', async () => {
      orders.findByRevealToken.mockResolvedValue(
        makeOrder({
          status: OrderStatus.FulfillmentInProgress,
          message_type: 'text',
          sender_message: 'Happy birthday!',
        }),
      );

      const view = await sut.view('token');

      expect(view.viewState).toBe('ready');
      expect(view.delivery).toEqual({ stage: 'awaiting_address' });
      // The message opens with the gift: not sent to the page before then.
      expect(view.message).toBeUndefined();
      expect(view.messageLocked).toBe(true);
      // No reveal_opened transition — that edge doesn't exist from here.
      expect(orders.transitionNormal).not.toHaveBeenCalled();
    });

    it('never shows a paid, undelivered hamper as expired', async () => {
      orders.findByRevealToken.mockResolvedValue(
        makeOrder({
          status: OrderStatus.Dispatched,
          expires_at: new Date(Date.now() - 86_400_000).toISOString(),
        }),
      );

      expect((await sut.view('token')).viewState).toBe('ready');
    });

    it('releases the message once delivered', async () => {
      orders.findByRevealToken.mockResolvedValue(
        makeOrder({
          status: OrderStatus.Delivered,
          message_type: 'text',
          sender_message: 'Happy birthday!',
        }),
      );

      const view = await sut.view('token');

      expect(view.message).toEqual({ type: 'text', text: 'Happy birthday!' });
      expect(view.messageLocked).toBeUndefined();
    });

    describe('paid for by a group', () => {
      const group = {
        organiserName: 'Bisi',
        contributorCount: 2,
        contributors: [
          { name: 'Bisi', message: 'From all of us!' },
          { name: 'Chidi', message: null },
        ],
      };

      it("holds back everyone's lines until the gift arrives, but says who chipped in", async () => {
        groupGifts.revealInfo.mockResolvedValue(group);
        orders.findByRevealToken.mockResolvedValue(
          makeOrder({
            status: OrderStatus.FulfillmentInProgress,
            group_gift_id: 'pot-1',
          }),
        );

        const view = await sut.view('token');

        expect(groupGifts.revealInfo).toHaveBeenCalledWith('pot-1');
        expect(view.group?.contributorCount).toBe(2);
        expect(view.group?.contributors.map((c) => c.name)).toEqual([
          'Bisi',
          'Chidi',
        ]);
        // Server-side lock: no line is in the payload before delivery.
        expect(view.group?.contributors.every((c) => c.message === null)).toBe(
          true,
        );
        expect(view.messageLocked).toBe(true);
      });

      it("shows everyone's lines once delivered", async () => {
        groupGifts.revealInfo.mockResolvedValue(group);
        orders.findByRevealToken.mockResolvedValue(
          makeOrder({ status: OrderStatus.Delivered, group_gift_id: 'pot-1' }),
        );

        const view = await sut.view('token');

        expect(view.group?.contributors[0]).toEqual({
          name: 'Bisi',
          message: 'From all of us!',
        });
      });

      it('never looks up a group for an ordinary gift', async () => {
        orders.findByRevealToken.mockResolvedValue(
          makeOrder({ status: OrderStatus.Delivered }),
        );

        const view = await sut.view('token');

        expect(groupGifts.revealInfo).not.toHaveBeenCalled();
        expect(view.group).toBeUndefined();
      });
    });

    it('accepting a delivered gift marks it opened (fulfilled)', async () => {
      orders.findByRevealToken.mockResolvedValue(
        makeOrder({ id: 'order-1', status: OrderStatus.Delivered }),
      );

      await sut.acceptGift('token');

      expect(deliveries.markOpened).toHaveBeenCalledWith('order-1');
      expect(redemptions.createPendingForOrder).not.toHaveBeenCalled();
    });

    it('passes the address to delivery and returns the refreshed view', async () => {
      orders.findByRevealToken.mockResolvedValue(
        makeOrder({ id: 'order-1', status: OrderStatus.FulfillmentInProgress }),
      );
      const details = { address: '12 Admiralty Way', area: 'Lekki Phase 1' };

      const view = await sut.setDelivery('token', details);

      expect(deliveries.setRecipientDetails).toHaveBeenCalledWith(
        'order-1',
        details,
      );
      expect(view.viewState).toBe('ready');
    });

    it('still treats a digital gift mid-fulfilment as not ready', async () => {
      gifts.findById.mockResolvedValue({
        id: 'template-1',
        name: 'Pizza',
        delivery_type: FulfillmentType.DigitalVoucher,
      });
      orders.findByRevealToken.mockResolvedValue(
        makeOrder({ status: OrderStatus.FulfillmentInProgress }),
      );

      expect((await sut.view('token')).viewState).toBe('not_ready');
    });
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

    it('shows the name typed for this gift, not the one saved with the email', async () => {
      // users.findById returns 'Chidi': whoever first used that email.
      orders.findByRevealToken.mockResolvedValue(
        makeOrder({
          status: OrderStatus.ReadyForRedemption,
          sender_name: 'Theo',
        }),
      );

      expect((await sut.view('reveal-token-1')).senderName).toBe('Theo');
    });

    it('says a group gift is from its organiser', async () => {
      groupGifts.revealInfo.mockResolvedValue({
        organiserName: 'Theo',
        contributorCount: 0,
        contributors: [],
      });
      orders.findByRevealToken.mockResolvedValue(
        makeOrder({
          status: OrderStatus.ReadyForRedemption,
          group_gift_id: 'pot-1',
        }),
      );

      expect((await sut.view('reveal-token-1')).senderName).toBe('Theo');
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
        qrPayload: 'EBN-7K2-9XQ',
      });
    });

    describe('after collection', () => {
      beforeEach(() => {
        orders.findByRevealToken.mockResolvedValue(
          makeOrder({ status: OrderStatus.Redeemed }),
        );
        gifts.findById.mockResolvedValue({
          id: 'template-1',
          name: 'Voucher',
          description: null,
          image_url: null,
          delivery_type: FulfillmentType.DigitalVoucher,
        });
      });

      it('says where and when it was collected', async () => {
        redemptions.findByOrderId.mockResolvedValue({
          status: RedemptionStatus.Completed,
          vendor_id: 'vendor-1',
          completed_at: '2026-10-11T03:50:00.000Z',
        });
        vendors.publicNameOf.mockResolvedValue('Burger Hub');

        const result = await sut.view('reveal-token-1');

        expect(vendors.publicNameOf).toHaveBeenCalledWith('vendor-1');
        expect(result.collected).toEqual({
          at: '2026-10-11T03:50:00.000Z',
          placeName: 'Burger Hub',
        });
        expect(result.redemption).toBeUndefined();
      });

      it('still shows the collected screen when the details lookup fails', async () => {
        redemptions.findByOrderId.mockRejectedValue(new Error('db down'));

        const result = await sut.view('reveal-token-1');

        expect(result.viewState).toBe('ready');
        expect(result.collected).toEqual({ at: null, placeName: null });
      });
    });

    describe('where to collect', () => {
      beforeEach(() => {
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
      });

      it('lists the places that accept the code alongside it', async () => {
        redemptions.findByOrderId.mockResolvedValue({
          status: RedemptionStatus.Pending,
          fallback_code: 'EBN-7K2-9XQ',
          redemption_token: 'redemption-token-1',
        });
        const points = [
          {
            name: 'Burger Hub',
            address: '12 Admiralty Way, Lekki',
            hours: 'Daily, 10am–10pm',
          },
        ];
        vendors.collectionPointsForGift.mockResolvedValue(points);

        const result = await sut.view('reveal-token-1');

        expect(vendors.collectionPointsForGift).toHaveBeenCalledWith(
          'template-1',
        );
        expect(result.collectAt).toEqual(points);
      });

      it('still returns the code when the places lookup fails — the voucher is the gift', async () => {
        redemptions.findByOrderId.mockResolvedValue({
          status: RedemptionStatus.Pending,
          fallback_code: 'EBN-7K2-9XQ',
          redemption_token: 'redemption-token-1',
        });
        vendors.collectionPointsForGift.mockRejectedValue(new Error('db down'));

        const result = await sut.view('reveal-token-1');

        expect(result.redemption?.fallbackCode).toBe('EBN-7K2-9XQ');
        expect(result.collectAt).toEqual([]);
      });

      it('does not look up places before the gift has been claimed', async () => {
        redemptions.findByOrderId.mockResolvedValue(null);

        const result = await sut.view('reveal-token-1');

        expect(vendors.collectionPointsForGift).not.toHaveBeenCalled();
        expect(result.collectAt).toBeUndefined();
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
        qrPayload: 'EBN-7K2-9XQ',
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

  describe('bookPickup', () => {
    const IN_ONE_HOUR = () => new Date(Date.now() + 60 * 60_000).toISOString();
    const place = {
      vendorId: 'vendor-1',
      name: 'Pizza Place',
      address: '1 Oba Adesida Rd, Akure',
      hours: null,
      whatsapp: '+2348022222222',
    };

    beforeEach(() => {
      orders.findByRevealToken.mockResolvedValue(
        makeOrder({ status: OrderStatus.RevealOpened }),
      );
      gifts.findById.mockResolvedValue({
        id: 'template-1',
        name: 'Pizza',
        description: null,
        image_url: null,
        delivery_type: FulfillmentType.DigitalVoucher,
      });
      redemptions.findByOrderId.mockResolvedValue({
        status: RedemptionStatus.Pending,
        fallback_code: 'EBN-7K2Q9X',
        redemption_token: 'redemption-token-1',
        expires_at: '2099-01-01T00:00:00.000Z',
      });
      vendors.collectionPointsForGift.mockResolvedValue([place]);
    });

    it('books the time at a place that accepts the code, and audits it', async () => {
      const at = IN_ONE_HOUR();

      await sut.bookPickup('reveal-token-1', 'vendor-1', at);

      expect(orders.recordPickup).toHaveBeenCalledWith(
        'order-1',
        'vendor-1',
        at,
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'order.pickup_booked',
          actorType: 'user',
          resourceId: 'order-1',
        }),
      );
      // And emails the vendor, in case nobody is watching "Coming in".
      expect(alerts.newPickup).toHaveBeenCalledWith('order-1', 'vendor-1', at);
    });

    it('refuses a place that cannot hand over this gift', async () => {
      await expect(
        sut.bookPickup('reveal-token-1', 'some-other-vendor', IN_ONE_HOUR()),
      ).rejects.toThrow("can't hand over this gift");
      expect(orders.recordPickup).not.toHaveBeenCalled();
    });

    it('refuses a time that has passed, or is more than a week out', async () => {
      const past = new Date(Date.now() - 60 * 60_000).toISOString();
      const farOff = new Date(Date.now() + 8 * 24 * 60 * 60_000).toISOString();

      await expect(
        sut.bookPickup('reveal-token-1', 'vendor-1', past),
      ).rejects.toThrow('Choose a time');
      await expect(
        sut.bookPickup('reveal-token-1', 'vendor-1', farOff),
      ).rejects.toThrow('Choose a time');
      expect(orders.recordPickup).not.toHaveBeenCalled();
    });

    it('refuses a time after the code expires', async () => {
      redemptions.findByOrderId.mockResolvedValue({
        status: RedemptionStatus.Pending,
        fallback_code: 'EBN-7K2Q9X',
        expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
      });

      await expect(
        sut.bookPickup('reveal-token-1', 'vendor-1', IN_ONE_HOUR()),
      ).rejects.toThrow('Choose a time');
    });

    it('refuses a gift that has not been claimed yet, or is already collected', async () => {
      redemptions.findByOrderId.mockResolvedValue(null);
      await expect(
        sut.bookPickup('reveal-token-1', 'vendor-1', IN_ONE_HOUR()),
      ).rejects.toThrow("can't be booked");

      redemptions.findByOrderId.mockResolvedValue({
        status: RedemptionStatus.Completed,
        expires_at: '2099-01-01T00:00:00.000Z',
      });
      await expect(
        sut.bookPickup('reveal-token-1', 'vendor-1', IN_ONE_HOUR()),
      ).rejects.toThrow("can't be booked");
    });

    it('409s when the order moved on between reading and booking', async () => {
      orders.recordPickup.mockResolvedValue(false);

      await expect(
        sut.bookPickup('reveal-token-1', 'vendor-1', IN_ONE_HOUR()),
      ).rejects.toThrow('changed since you opened it');
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('shows the booking, and whether the vendor has confirmed, on the gift page', async () => {
      const at = IN_ONE_HOUR();
      orders.findByRevealToken.mockResolvedValue(
        makeOrder({
          status: OrderStatus.RevealOpened,
          pickup_vendor_id: 'vendor-1',
          pickup_at: at,
          pickup_confirmed_at: '2026-10-12T10:00:00.000Z',
        }),
      );

      const result = await sut.view('reveal-token-1');

      expect(result.pickup).toEqual({
        vendorId: 'vendor-1',
        placeName: 'Pizza Place',
        whatsapp: '+2348022222222',
        at,
        confirmed: true,
      });
    });
  });
});
