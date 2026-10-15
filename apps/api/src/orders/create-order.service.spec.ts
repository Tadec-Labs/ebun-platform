import { Test } from '@nestjs/testing';
import { OrderStatus } from '@ebun/types';
import { CreateOrderService } from './create-order.service';
import { GiftsService } from '../gifts/gifts.service';
import { UsersService } from '../users/users.service';
import { OrdersService } from './orders.service';
import { PaystackClientService } from '../paystack/paystack-client.service';
import { PricingService } from '../pricing/pricing.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { MessageMediaService } from '../media/message-media.service';

function makeDto(overrides: Partial<CreateOrderDto> = {}): CreateOrderDto {
  return Object.assign(new CreateOrderDto(), {
    giftTemplateId: 'template-1',
    recipientName: 'Recipient Name',
    recipientPhone: '+2348012345678',
    senderName: 'Sender Name',
    senderEmail: 'sender@example.com',
    ...overrides,
  });
}

describe('CreateOrderService', () => {
  let sut: CreateOrderService;
  let gifts: { findAvailableById: jest.Mock };
  let users: { findOrCreateGuestSender: jest.Mock };
  let orders: { create: jest.Mock; transitionNormal: jest.Mock };
  let paystack: { initializeTransaction: jest.Mock };
  let media: { isEnabled: jest.Mock; store: jest.Mock; delete: jest.Mock };

  const recording = { buffer: Buffer.from('x'), size: 1 };

  beforeEach(async () => {
    media = {
      isEnabled: jest.fn().mockReturnValue(true),
      store: jest.fn().mockResolvedValue('messages/abc.webm'),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    gifts = { findAvailableById: jest.fn() };
    users = { findOrCreateGuestSender: jest.fn() };
    orders = { create: jest.fn(), transitionNormal: jest.fn() };
    paystack = { initializeTransaction: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        CreateOrderService,
        { provide: GiftsService, useValue: gifts },
        { provide: UsersService, useValue: users },
        { provide: OrdersService, useValue: orders },
        { provide: PaystackClientService, useValue: paystack },
        { provide: MessageMediaService, useValue: media },
        // Real, not mocked: the fee arithmetic is the thing under test.
        PricingService,
      ],
    }).compile();

    sut = moduleRef.get(CreateOrderService);

    gifts.findAvailableById.mockResolvedValue({
      id: 'template-1',
      base_price: 500000,
    });
    users.findOrCreateGuestSender.mockResolvedValue({ id: 'user-1' });
    orders.create.mockResolvedValue({
      id: 'order-1',
      order_number: 'EBN-0001',
    });
    paystack.initializeTransaction.mockResolvedValue({
      authorizationUrl: 'https://checkout.paystack.com/xyz',
      accessCode: 'code',
      reference: 'ebun_ref',
    });
  });

  it('runs the full sequence and returns the checkout URL', async () => {
    const result = await sut.execute(makeDto(), '127.0.0.1');

    expect(gifts.findAvailableById).toHaveBeenCalledWith('template-1');
    expect(users.findOrCreateGuestSender).toHaveBeenCalledWith({
      email: 'sender@example.com',
      phone: undefined,
      name: 'Sender Name',
    });
    // price computed server-side from the template, not from the DTO:
    // ₦5,000 gift + 5% service fee (₦250) = ₦5,250, and Paystack is
    // asked for exactly that total
    expect(orders.create).toHaveBeenCalledWith(
      expect.objectContaining({
        giftValue: 500000,
        deliveryFee: 0,
        serviceFee: 25000,
        totalAmount: 525000,
      }),
    );
    expect(paystack.initializeTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'sender@example.com',
        amountKobo: 525000,
      }),
    );
    expect(orders.transitionNormal).toHaveBeenCalledWith(
      'order-1',
      OrderStatus.Draft,
      OrderStatus.PendingPayment,
      { type: 'system' },
      expect.any(Object),
    );
    expect(result).toEqual({
      orderId: 'order-1',
      orderNumber: 'EBN-0001',
      checkoutUrl: 'https://checkout.paystack.com/xyz',
    });
  });

  it('marks the sender as diaspora only when senderCountryCode is present and not NG', async () => {
    await sut.execute(makeDto({ senderCountryCode: 'GB' }), '127.0.0.1');
    expect(orders.create).toHaveBeenCalledWith(
      expect.objectContaining({ isDiasporaSender: true }),
    );

    await sut.execute(makeDto({ senderCountryCode: 'NG' }), '127.0.0.1');
    expect(orders.create).toHaveBeenCalledWith(
      expect.objectContaining({ isDiasporaSender: false }),
    );

    await sut.execute(makeDto(), '127.0.0.1'); // omitted entirely
    expect(orders.create).toHaveBeenCalledWith(
      expect.objectContaining({ isDiasporaSender: false }),
    );
  });

  describe('voice and video messages', () => {
    it('stores the recording and puts its private key — not a URL — on the order', async () => {
      await sut.execute(
        makeDto({ messageType: 'voice', messageDurationSecs: 42 }),
        '127.0.0.1',
        recording,
      );

      expect(media.store).toHaveBeenCalledWith('voice', recording);
      expect(orders.create).toHaveBeenCalledWith(
        expect.objectContaining({
          messageType: 'voice',
          messageUrl: 'messages/abc.webm',
          messageDurationSecs: 42,
        }),
      );
    });

    it.each([
      [
        'storage is switched off',
        () => media.isEnabled.mockReturnValue(false),
        makeDto({ messageType: 'video' }),
        recording,
        /aren't available/,
      ],
      [
        'no recording came with it',
        () => undefined,
        makeDto({ messageType: 'voice' }),
        undefined,
        /Record your voice note/,
      ],
      [
        'a recording came with a written message',
        () => undefined,
        makeDto({ messageType: 'text' }),
        recording,
        /written message/,
      ],
      [
        'the video is longer than 30 seconds',
        () => undefined,
        makeDto({ messageType: 'video', messageDurationSecs: 45 }),
        recording,
        /up to 30 seconds/,
      ],
    ])(
      'refuses before touching anything when %s',
      async (_label, arrange, dto, file, message) => {
        arrange();
        await expect(sut.execute(dto, '127.0.0.1', file)).rejects.toThrow(
          message,
        );

        expect(gifts.findAvailableById).not.toHaveBeenCalled();
        expect(media.store).not.toHaveBeenCalled();
        expect(orders.create).not.toHaveBeenCalled();
        expect(paystack.initializeTransaction).not.toHaveBeenCalled();
      },
    );

    it("doesn't store anything for a gift that can't be bought", async () => {
      gifts.findAvailableById.mockRejectedValue(new Error('not found'));

      await expect(
        sut.execute(makeDto({ messageType: 'voice' }), '127.0.0.1', recording),
      ).rejects.toThrow('not found');
      expect(media.store).not.toHaveBeenCalled();
    });

    it('deletes the recording again if the order is never created', async () => {
      users.findOrCreateGuestSender.mockRejectedValue(new Error('db down'));

      await expect(
        sut.execute(makeDto({ messageType: 'voice' }), '127.0.0.1', recording),
      ).rejects.toThrow('db down');
      expect(media.delete).toHaveBeenCalledWith('messages/abc.webm');
    });

    it('keeps the recording once an order points at it, even if Paystack fails', async () => {
      paystack.initializeTransaction.mockRejectedValue(new Error('down'));

      await expect(
        sut.execute(makeDto({ messageType: 'voice' }), '127.0.0.1', recording),
      ).rejects.toThrow('down');
      expect(orders.create).toHaveBeenCalled();
      expect(media.delete).not.toHaveBeenCalled();
    });
  });

  it('propagates a gift-template-not-found error before touching anything else', async () => {
    gifts.findAvailableById.mockRejectedValue(new Error('not found'));

    await expect(sut.execute(makeDto(), '127.0.0.1')).rejects.toThrow(
      'not found',
    );

    expect(users.findOrCreateGuestSender).not.toHaveBeenCalled();
    expect(orders.create).not.toHaveBeenCalled();
  });

  it('leaves the order in draft (never transitions) if the Paystack call fails', async () => {
    paystack.initializeTransaction.mockRejectedValue(
      new Error('Paystack unreachable'),
    );

    await expect(sut.execute(makeDto(), '127.0.0.1')).rejects.toThrow(
      'Paystack unreachable',
    );

    // The order WAS created (it has to exist before we can pay for it)...
    expect(orders.create).toHaveBeenCalled();
    // ...but the transition to pending_payment must never have been attempted.
    expect(orders.transitionNormal).not.toHaveBeenCalled();
  });
});
