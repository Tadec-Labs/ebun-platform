import { createHmac } from 'crypto';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OrderStatus } from '@ebun/types';
import { PaystackWebhookService } from './paystack-webhook.service';
import { OrdersService } from '../orders/orders.service';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { FulfillmentOrchestratorService } from '../fulfillment/fulfillment-orchestrator.service';
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
    recordPaymentVerified: jest.Mock;
  };
  let idempotency: { claim: jest.Mock };
  let fulfillment: { start: jest.Mock };

  beforeEach(async () => {
    ordersService = {
      findByPaystackReference: jest.fn(),
      transitionNormal: jest.fn(),
      recordPaymentVerified: jest.fn().mockResolvedValue(undefined),
    };
    idempotency = { claim: jest.fn().mockResolvedValue(true) };
    fulfillment = { start: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PaystackWebhookService,
        { provide: OrdersService, useValue: ordersService },
        { provide: IdempotencyService, useValue: idempotency },
        { provide: ConfigService, useValue: { getOrThrow: () => SECRET } },
        {
          provide: FulfillmentOrchestratorService,
          useValue: fulfillment,
        },
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
    expect(fulfillment.start).toHaveBeenCalledWith('order-1');
  });

  it('stamps payment_verified_at, after the transition rather than before', async () => {
    // The column exists in the schema and nothing wrote it, so every
    // order read as "payment verified: never" — including healthy ones.
    const { raw, signature, dto } = makePayload();
    const calls: string[] = [];
    ordersService.findByPaystackReference.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.PendingPayment,
      total_amount: 500000,
    });
    ordersService.transitionNormal.mockImplementation(() => {
      calls.push('transition');
      return Promise.resolve();
    });
    ordersService.recordPaymentVerified.mockImplementation(() => {
      calls.push('stamp');
      return Promise.resolve();
    });

    await sut.handle(raw, signature, dto);

    expect(ordersService.recordPaymentVerified).toHaveBeenCalledWith('order-1');
    // Order matters: the transition is the compare-and-swap that decides
    // whether this webhook won the race. Stamping first would mark an
    // order verified even when a concurrent writer took the transition.
    expect(calls).toEqual(['transition', 'stamp']);
  });

  it('still fulfils when the verification stamp fails — a missing timestamp must not cost a delivery', async () => {
    const { raw, signature, dto } = makePayload();
    ordersService.findByPaystackReference.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.PendingPayment,
      total_amount: 500000,
    });
    ordersService.recordPaymentVerified.mockRejectedValue(
      new Error('column is having a bad day'),
    );

    await expect(sut.handle(raw, signature, dto)).resolves.toBeUndefined();
    expect(fulfillment.start).toHaveBeenCalledWith('order-1');
  });

  it('logs and swallows a fulfillment orchestration failure — a confirmed payment must not be undone or surfaced as a webhook error', async () => {
    const { raw, signature, dto } = makePayload();
    ordersService.findByPaystackReference.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.PendingPayment,
      total_amount: 500000,
    });
    fulfillment.start.mockRejectedValue(new Error('VTU provider exploded'));

    // Does NOT throw/reject — the webhook still reports success to Paystack.
    await expect(sut.handle(raw, signature, dto)).resolves.toBeUndefined();

    expect(ordersService.transitionNormal).toHaveBeenCalled();
    expect(fulfillment.start).toHaveBeenCalledWith('order-1');
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
