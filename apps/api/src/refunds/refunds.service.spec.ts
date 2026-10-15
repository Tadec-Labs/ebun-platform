import {
  BadGatewayException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { OrderStatus, RedemptionStatus } from '@ebun/types';
import { AuditService } from '../audit/audit.service';
import type { StaffContext } from '../auth/staff.guard';
import { OrderTransitionConflictException } from '../orders/exceptions/order-transition-conflict.exception';
import { OrdersService } from '../orders/orders.service';
import { PaystackWebhookDto } from '../payments/dto/paystack-webhook.dto';
import {
  PaystackClientService,
  PaystackRefundRejectedError,
} from '../paystack/paystack-client.service';
import { RefundRefusedError, RefundsRepository } from './refunds.repository';
import { REFUNDABLE_STATUSES, RefundsService } from './refunds.service';

const STAFF: StaffContext = {
  userId: 'staff-1',
  authId: 'auth-1',
  role: 'ebun_admin',
  email: 'ops@ebun.example',
  name: 'Ops',
};
const META = { ipAddress: '1.2.3.4', userAgent: 'jest' };
const INPUT = {
  reasonCategory: 'vendor_failure' as const,
  reason: 'Partner closed for the week',
  alreadyRefundedInPaystack: false,
};

const BEGUN = {
  refundId: 'refund-1',
  amount: 840000,
  paystackReference: 'ebun_ref_1',
  orderStatus: OrderStatus.RevealOpened,
  voidedRedemptionStatus: RedemptionStatus.Pending,
};

describe('RefundsService', () => {
  let sut: RefundsService;
  let repository: Record<string, jest.Mock>;
  let orders: { transitionAdminOverride: jest.Mock };
  let paystack: { createRefund: jest.Mock };
  let audit: { record: jest.Mock };

  beforeEach(() => {
    repository = {
      begin: jest.fn().mockResolvedValue(BEGUN),
      abandon: jest.fn().mockResolvedValue(undefined),
      markSubmitted: jest.fn().mockResolvedValue({}),
      markRecordedManually: jest.fn().mockResolvedValue({}),
      applyProgress: jest.fn().mockResolvedValue(null),
      findOrder: jest.fn().mockResolvedValue({
        id: 'order-1',
        status: OrderStatus.Refunded,
        total_amount: 840000,
        vendor_payout_amount: null,
        paystack_reference: 'ebun_ref_1',
      }),
      listForOrder: jest.fn().mockResolvedValue([]),
    };
    orders = { transitionAdminOverride: jest.fn().mockResolvedValue({}) };
    paystack = {
      createRefund: jest
        .fn()
        .mockResolvedValue({ id: '3018284', status: 'pending' }),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    sut = new RefundsService(
      repository as unknown as RefundsRepository,
      orders as unknown as OrdersService,
      paystack as unknown as PaystackClientService,
      audit as unknown as AuditService,
    );
  });

  describe('refund', () => {
    it('checks and voids under one lock, asks Paystack for the full amount, then closes the order', async () => {
      await sut.refund('order-1', INPUT, STAFF, META);

      expect(repository.begin).toHaveBeenCalledWith({
        orderId: 'order-1',
        refundableStatuses: REFUNDABLE_STATUSES,
        reason: INPUT.reason,
        reasonCategory: 'vendor_failure',
        initiatedBy: 'staff-1',
      });
      expect(paystack.createRefund).toHaveBeenCalledWith(
        expect.objectContaining({
          transactionReference: 'ebun_ref_1',
          amountKobo: 840000,
        }),
      );
      expect(repository.markSubmitted).toHaveBeenCalledWith(
        'refund-1',
        '3018284',
      );
      expect(orders.transitionAdminOverride).toHaveBeenCalledWith(
        'order-1',
        OrderStatus.RevealOpened,
        OrderStatus.Refunded,
        { type: 'admin', id: 'staff-1' },
        { refundId: 'refund-1', amount: 840000 },
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'refund.initiated',
          actorId: 'staff-1',
          resourceId: 'order-1',
        }),
      );
    });

    it('gives the recipient their code back and changes nothing when Paystack refuses', async () => {
      paystack.createRefund.mockRejectedValue(
        new PaystackRefundRejectedError('Transaction has been fully reversed'),
      );

      await expect(sut.refund('order-1', INPUT, STAFF, META)).rejects.toThrow(
        ConflictException,
      );
      expect(repository.abandon).toHaveBeenCalledWith(
        'refund-1',
        'Paystack: Transaction has been fully reversed',
        RedemptionStatus.Pending,
      );
      expect(orders.transitionAdminOverride).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('does the same when Paystack is unreachable, as a 502', async () => {
      paystack.createRefund.mockRejectedValue(new Error('ECONNRESET'));

      await expect(sut.refund('order-1', INPUT, STAFF, META)).rejects.toThrow(
        BadGatewayException,
      );
      expect(repository.abandon).toHaveBeenCalled();
      expect(orders.transitionAdminOverride).not.toHaveBeenCalled();
    });

    it('records a dashboard refund without asking Paystack again', async () => {
      await sut.refund(
        'order-1',
        { ...INPUT, alreadyRefundedInPaystack: true },
        STAFF,
        META,
      );

      expect(paystack.createRefund).not.toHaveBeenCalled();
      expect(repository.markRecordedManually).toHaveBeenCalledWith('refund-1');
      expect(orders.transitionAdminOverride).toHaveBeenCalled();
    });

    it.each([
      [
        'vendor_credited',
        ConflictException,
        /partner has already been credited/,
      ],
      ['already_collected', ConflictException, /already been collected/],
      ['already_refunding', ConflictException, /already under way/],
      ['order_not_found', NotFoundException, /not found/],
    ] as const)(
      'refuses (%s) before touching Paystack',
      async (reason, type, message) => {
        repository.begin.mockRejectedValue(new RefundRefusedError(reason));

        const attempt = sut.refund('order-1', INPUT, STAFF, META);
        await expect(attempt).rejects.toThrow(type);
        await expect(attempt).rejects.toThrow(message);
        expect(paystack.createRefund).not.toHaveBeenCalled();
      },
    );

    it('closes the order from its current status if something moved it meanwhile', async () => {
      orders.transitionAdminOverride.mockRejectedValueOnce(
        new OrderTransitionConflictException(
          'order-1',
          OrderStatus.RevealOpened,
          OrderStatus.Refunded,
        ),
      );
      repository.findOrder.mockResolvedValueOnce({
        id: 'order-1',
        status: OrderStatus.Expired,
        total_amount: 840000,
        vendor_payout_amount: null,
        paystack_reference: 'ebun_ref_1',
      });

      await sut.refund('order-1', INPUT, STAFF, META);

      expect(orders.transitionAdminOverride).toHaveBeenLastCalledWith(
        'order-1',
        OrderStatus.Expired,
        OrderStatus.Refunded,
        expect.anything(),
        expect.anything(),
      );
    });
  });

  describe('forOrder', () => {
    const order = (over: Record<string, unknown>) => ({
      id: 'order-1',
      status: OrderStatus.RevealOpened,
      total_amount: 840000,
      vendor_payout_amount: null,
      paystack_reference: 'ebun_ref_1',
      ...over,
    });

    it('allows a refund on a paid gift nobody has collected', async () => {
      repository.findOrder.mockResolvedValue(order({}));
      await expect(sut.forOrder('order-1')).resolves.toMatchObject({
        cannotRefundBecause: null,
        refundAmount: 840000,
      });
    });

    it.each([
      [{ status: OrderStatus.Redeemed }, /handed over/],
      [{ status: OrderStatus.PendingPayment }, /Nothing was paid/],
      [{ vendor_payout_amount: 720000 }, /partner has already been credited/],
    ])('says why not for %o', async (over, message) => {
      repository.findOrder.mockResolvedValue(order(over));
      const view = await sut.forOrder('order-1');
      expect(view.cannotRefundBecause).toMatch(message);
    });

    it('allows a retry after a failed attempt, but not alongside an active one', async () => {
      repository.findOrder.mockResolvedValue(order({}));
      repository.listForOrder.mockResolvedValue([
        { id: 'r1', status: 'failed', amount: 840000, created_at: 'x' },
      ]);
      expect((await sut.forOrder('order-1')).cannotRefundBecause).toBeNull();

      repository.listForOrder.mockResolvedValue([
        { id: 'r2', status: 'processing', amount: 840000, created_at: 'x' },
      ]);
      expect((await sut.forOrder('order-1')).cannotRefundBecause).toMatch(
        /already under way/,
      );
    });
  });

  describe('Paystack refund webhooks', () => {
    it('completes the refund on refund.processed, and audits it', async () => {
      repository.applyProgress.mockResolvedValue({
        id: 'refund-1',
        order_id: 'order-1',
        status: 'completed',
      });

      await sut.applyPaystackRefundEvent('refund.processed', 'ebun_ref_1');

      expect(repository.applyProgress).toHaveBeenCalledWith(
        'ebun_ref_1',
        expect.objectContaining({ status: 'completed' }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'refund.processed',
          resourceId: 'order-1',
        }),
      );
    });

    it('marks it failed on refund.failed, with what to do', async () => {
      repository.applyProgress.mockResolvedValue({
        id: 'refund-1',
        order_id: 'order-1',
        status: 'failed',
      });

      await sut.applyPaystackRefundEvent('refund.failed', 'ebun_ref_1');

      expect(repository.applyProgress).toHaveBeenCalledWith(
        'ebun_ref_1',
        expect.objectContaining({
          status: 'failed',
          failure_reason: expect.stringMatching(/another way/) as unknown,
        }),
      );
    });

    it('ignores progress events, and refunds it never started', async () => {
      await sut.applyPaystackRefundEvent('refund.pending', 'ebun_ref_1');
      expect(repository.applyProgress).not.toHaveBeenCalled();

      await sut.applyPaystackRefundEvent('refund.processed', 'unknown');
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  it('accepts Paystack refund payloads at the webhook DTO (string amount, transaction_reference)', async () => {
    const dto = plainToInstance(PaystackWebhookDto, {
      event: 'refund.processed',
      data: {
        transaction_reference: 'ebun_ref_1',
        amount: '840000',
        status: 'processed',
        currency: 'NGN',
      },
    });
    expect(await validate(dto)).toEqual([]);
    expect(dto.data.amount).toBe(840000);
  });
});
