import { createHmac } from 'crypto';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OrderStatus } from '@ebun/types';
import { PaystackWebhookService } from './paystack-webhook.service';
import { OrdersService } from '../orders/orders.service';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { PaystackWebhookDto } from './dto/paystack-webhook.dto';

const SECRET = 'sk_test_fake_secret';

function makePayload(overrides: Partial<PaystackWebhookDto['data']> = {}): {
  raw: Buffer;
  signature: string;
  dto: PaystackWebhookDto;
} {
  const dto: PaystackWebhookDto = {
    event: 'charge.success',
    data: {
      id: 999,
      reference: 'ref_abc123',
      amount: 500000,
      status: 'success',
      ...overrides,
    },
  };
  const raw = Buffer.from(JSON.stringify(dto));
  const signature = createHmac('sha512', SECRET).update(raw).digest('hex');
  return { raw, signature, dto };
}

describe('PaystackWebhookService', () => {
  let sut: PaystackWebhookService;
  let ordersService: {
    findByPaystackReference: jest.Mock;
    transitionNormal: jest.Mock;
  };
  let idempotency: { claim: jest.Mock };

  beforeEach(async () => {
    ordersService = {
      findByPaystackReference: jest.fn(),
      transitionNormal: jest.fn(),
    };
    idempotency = { claim: jest.fn().mockResolvedValue(true) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PaystackWebhookService,
        { provide: OrdersService, useValue: ordersService },
        { provide: IdempotencyService, useValue: idempotency },
        { provide: ConfigService, useValue: { getOrThrow: () => SECRET } },
      ],
    }).compile();

    sut = moduleRef.get(PaystackWebhookService);
  });

  it('verifies the signature, claims idempotency, checks amount, then transitions the order', async () => {
    const { raw, signature, dto } = makePayload();
    ordersService.findByPaystackReference.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.PendingPayment,
      total_amount: 500000,
    });

    await sut.handle(raw, signature, dto);

    expect(idempotency.claim).toHaveBeenCalledWith(
      'paystack_webhook_evt_999',
      'paystack_webhook',
    );
    expect(ordersService.transitionNormal).toHaveBeenCalledWith(
      'order-1',
      OrderStatus.PendingPayment,
      OrderStatus.Paid,
      { type: 'webhook' },
      expect.objectContaining({
        paystackReference: 'ref_abc123',
        paystackTransactionId: 999,
      }),
    );
  });

  it('rejects an invalid signature before doing anything else', async () => {
    const { raw, dto } = makePayload();

    await expect(
      sut.handle(raw, 'totally-wrong-signature', dto),
    ).rejects.toThrow('Invalid Paystack webhook signature');

    expect(idempotency.claim).not.toHaveBeenCalled();
    expect(ordersService.findByPaystackReference).not.toHaveBeenCalled();
  });

  it('ignores event types other than charge.success without touching idempotency or orders', async () => {
    const raw = Buffer.from(
      JSON.stringify({
        event: 'transfer.success',
        data: { id: 1, reference: 'x', amount: 1 },
      }),
    );
    const signature = createHmac('sha512', SECRET).update(raw).digest('hex');
    const dto = {
      event: 'transfer.success',
      data: { id: 1, reference: 'x', amount: 1, status: 'success' },
    };

    await sut.handle(raw, signature, dto);

    expect(idempotency.claim).not.toHaveBeenCalled();
    expect(ordersService.findByPaystackReference).not.toHaveBeenCalled();
  });

  it('no-ops on a duplicate delivery (idempotency claim fails) without touching orders', async () => {
    idempotency.claim.mockResolvedValue(false);
    const { raw, signature, dto } = makePayload();

    await sut.handle(raw, signature, dto);

    expect(ordersService.findByPaystackReference).not.toHaveBeenCalled();
    expect(ordersService.transitionNormal).not.toHaveBeenCalled();
  });

  it('throws if no order matches the Paystack reference', async () => {
    const { raw, signature, dto } = makePayload();
    ordersService.findByPaystackReference.mockResolvedValue(null);

    await expect(sut.handle(raw, signature, dto)).rejects.toThrow(
      /No order found/,
    );
    expect(ordersService.transitionNormal).not.toHaveBeenCalled();
  });

  it('throws on an amount mismatch and does not transition the order', async () => {
    const { raw, signature, dto } = makePayload({ amount: 500000 });
    ordersService.findByPaystackReference.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.PendingPayment,
      total_amount: 999999, // deliberately different from the payload's amount
    });

    await expect(sut.handle(raw, signature, dto)).rejects.toThrow(
      /Amount mismatch/,
    );
    expect(ordersService.transitionNormal).not.toHaveBeenCalled();
  });
});
