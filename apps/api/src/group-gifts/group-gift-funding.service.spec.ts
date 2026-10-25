import { PaystackRefundRejectedError } from '../paystack/paystack-client.service';
import { GroupGiftFundingService } from './group-gift-funding.service';
import type {
  ContributionRow,
  GroupGiftsRepository,
} from './group-gifts.repository';

function owed(overrides: Partial<ContributionRow> = {}): ContributionRow {
  return {
    id: 'c-1',
    group_gift_id: 'pot-1',
    contributor_name: 'Bisi',
    contributor_email: 'bisi@example.com',
    contributor_phone: null,
    amount: 1_000_000,
    service_fee: 50_000,
    total_amount: 1_050_000,
    message: null,
    paystack_reference: 'ebgrp_1',
    status: 'confirmed',
    confirmed_at: null,
    refund_status: 'submitting',
    refund_amount: 1_050_000,
    refund_attempts: 0,
    refund_error: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('GroupGiftFundingService', () => {
  let sut: GroupGiftFundingService;
  let repository: Record<string, jest.Mock>;
  let fulfillment: { start: jest.Mock };
  let paystack: { createRefund: jest.Mock };
  let audit: { record: jest.Mock };
  let kick: jest.SpyInstance;

  beforeEach(() => {
    repository = {
      confirmContribution: jest.fn().mockResolvedValue('confirmed'),
      findByContributionReference: jest
        .fn()
        .mockResolvedValue({ id: 'pot-1', linked_order_id: 'order-1' }),
      refundsOwed: jest.fn().mockResolvedValue(['c-1']),
      claimRefund: jest.fn().mockResolvedValue(owed()),
      refundSubmitted: jest.fn().mockResolvedValue(undefined),
      refundNotSent: jest.fn().mockResolvedValue(undefined),
      applyRefundProgress: jest.fn().mockResolvedValue(owed()),
      overdue: jest.fn().mockResolvedValue(['pot-1', 'pot-2']),
      close: jest.fn().mockResolvedValue(1),
      ordersReadyToFulfil: jest.fn().mockResolvedValue([]),
    };
    fulfillment = { start: jest.fn().mockResolvedValue(undefined) };
    paystack = { createRefund: jest.fn().mockResolvedValue({ id: 'rf_1' }) };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    sut = new GroupGiftFundingService(
      repository as unknown as GroupGiftsRepository,
      fulfillment as never,
      paystack as never,
      audit as never,
    );
    kick = jest.spyOn(sut, 'kickRefunds').mockImplementation(() => undefined);
  });

  describe('applyPayment', () => {
    it("starts the gift's fulfilment when this share funded the pot", async () => {
      repository.confirmContribution.mockResolvedValue('funded');
      const after = jest.spyOn(sut, 'afterFunded');

      await sut.applyPayment('ebgrp_1', 1_050_000, '42');

      expect(repository.confirmContribution).toHaveBeenCalledWith(
        'ebgrp_1',
        1_050_000,
        '42',
      );
      expect(after).toHaveBeenCalledWith('pot-1', 'order-1');
      await new Promise((resolve) => setImmediate(resolve));
      expect(fulfillment.start).toHaveBeenCalledWith('order-1');
    });

    it('queues a refund for a share that arrived after the pot closed', async () => {
      repository.confirmContribution.mockResolvedValue('late');

      await sut.applyPayment('ebgrp_1', 1_050_000, '42');

      expect(kick).toHaveBeenCalled();
      expect(fulfillment.start).not.toHaveBeenCalled();
    });

    it('records an amount mismatch loudly and does not ask Paystack to retry', async () => {
      repository.confirmContribution.mockRejectedValue(
        new Error('contribution_amount_mismatch'),
      );

      await expect(
        sut.applyPayment('ebgrp_1', 1, '42'),
      ).resolves.toBeUndefined();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'group_gift.payment_unmatched' }),
      );
    });

    it('lets a transient failure through so Paystack redelivers', async () => {
      repository.confirmContribution.mockRejectedValue(
        new Error('connection reset'),
      );

      await expect(
        sut.applyPayment('ebgrp_1', 1_050_000, '42'),
      ).rejects.toThrow('connection reset');
    });
  });

  describe('processRefunds', () => {
    it('sends each claimed refund to Paystack for exactly the amount owed', async () => {
      repository.claimRefund.mockResolvedValue(owed({ refund_amount: 47_620 }));

      const result = await sut.processRefunds();

      expect(paystack.createRefund).toHaveBeenCalledWith(
        expect.objectContaining({
          transactionReference: 'ebgrp_1',
          amountKobo: 47_620,
        }),
      );
      expect(repository.refundSubmitted).toHaveBeenCalledWith('c-1', 'rf_1');
      expect(result).toEqual({ sent: 1, failed: 0 });
    });

    it('skips a row another worker already claimed', async () => {
      repository.claimRefund.mockResolvedValue(null);

      await sut.processRefunds();

      expect(paystack.createRefund).not.toHaveBeenCalled();
    });

    it('puts a refund back in the queue after a network failure', async () => {
      paystack.createRefund.mockRejectedValue(new Error('ETIMEDOUT'));

      await sut.processRefunds();

      expect(repository.refundNotSent).toHaveBeenCalledWith(
        'c-1',
        1,
        expect.stringContaining('ETIMEDOUT'),
        false,
      );
    });

    it('fails a refund Paystack refused, for a person to settle', async () => {
      paystack.createRefund.mockRejectedValue(
        new PaystackRefundRejectedError('Transaction has been fully reversed'),
      );

      const result = await sut.processRefunds();

      expect(repository.refundNotSent).toHaveBeenCalledWith(
        'c-1',
        1,
        'Paystack: Transaction has been fully reversed',
        true,
      );
      expect(result.failed).toBe(1);
    });

    it('gives up after five network failures', async () => {
      repository.claimRefund.mockResolvedValue(owed({ refund_attempts: 4 }));
      paystack.createRefund.mockRejectedValue(new Error('ETIMEDOUT'));

      await sut.processRefunds();

      expect(repository.refundNotSent).toHaveBeenCalledWith(
        'c-1',
        5,
        expect.any(String),
        true,
      );
    });
  });

  it('maps Paystack refund events onto the share', async () => {
    await sut.applyRefundEvent('refund.processed', 'ebgrp_1');
    expect(repository.applyRefundProgress).toHaveBeenCalledWith(
      'ebgrp_1',
      'completed',
    );

    await sut.applyRefundEvent('refund.pending', 'ebgrp_1');
    expect(repository.applyRefundProgress).toHaveBeenCalledTimes(1);
  });

  it('closes pots 48 hours past their deadline, as the clock', async () => {
    const before = Date.now();

    await expect(sut.closeOverdue()).resolves.toBe(2);

    const [cutoffDate] = repository.overdue.mock.calls[0] as [Date];
    const cutoff = cutoffDate.getTime();
    expect(before - cutoff).toBeGreaterThanOrEqual(48 * 3_600_000 - 1_000);
    expect(repository.close).toHaveBeenCalledWith(
      'pot-1',
      'expired',
      expect.any(String),
      'cron',
    );
    expect(kick).toHaveBeenCalled();
  });
});
