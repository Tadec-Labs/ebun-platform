import { Test } from '@nestjs/testing';
import { OrderStatus } from '@ebun/types';
import { CreateOrderService } from './create-order.service';
import { GiftsService } from '../gifts/gifts.service';
import { UsersService } from '../users/users.service';
import { OrdersService } from './orders.service';
import { PaystackClientService } from '../paystack/paystack-client.service';
import { CreateOrderDto } from './dto/create-order.dto';

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

  beforeEach(async () => {
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
    // price computed server-side from the template, not from the DTO
    expect(orders.create).toHaveBeenCalledWith(
      expect.objectContaining({
        giftValue: 500000,
        deliveryFee: 0,
        serviceFee: 0,
        totalAmount: 500000,
      }),
    );
    expect(paystack.initializeTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'sender@example.com',
        amountKobo: 500000,
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

  it('rejects voice/video messageType before touching gifts, users, orders, or Paystack', async () => {
    await expect(
      sut.execute(makeDto({ messageType: 'voice' }), '127.0.0.1'),
    ).rejects.toThrow(/not yet supported/);

    expect(gifts.findAvailableById).not.toHaveBeenCalled();
    expect(users.findOrCreateGuestSender).not.toHaveBeenCalled();
    expect(orders.create).not.toHaveBeenCalled();
    expect(paystack.initializeTransaction).not.toHaveBeenCalled();
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
