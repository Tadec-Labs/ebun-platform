import { EventFundingService } from './event-funding.service';
import type { EventsRepository } from './events.repository';
import { givingClosesAt, giftsSendAt } from './events.config';

describe('EventFundingService', () => {
  let repository: Record<string, jest.Mock>;
  let paystack: { createRefund: jest.Mock };
  let audit: { record: jest.Mock };
  let env: Record<string, string | undefined>;
  let sut: EventFundingService;

  beforeEach(() => {
    repository = {
      confirmCashGift: jest.fn().mockResolvedValue('confirmed'),
      refundsOwed: jest.fn().mockResolvedValue(['gift-1']),
      claimRefund: jest.fn().mockResolvedValue({
        id: 'gift-1',
        event_id: 'event-1',
        paystack_reference: 'ebevt_1',
        refund_amount: 525_000,
        refund_attempts: 0,
      }),
      refundSubmitted: jest.fn().mockResolvedValue(undefined),
      refundNotSent: jest.fn().mockResolvedValue(undefined),
      applyRefundProgress: jest.fn(),
      activeOnOrBefore: jest.fn().mockResolvedValue(['event-1']),
      close: jest.fn().mockResolvedValue(true),
    };
    paystack = { createRefund: jest.fn().mockResolvedValue({ id: 'rfnd_1' }) };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    env = {};
    sut = new EventFundingService(
      repository as unknown as EventsRepository,
      paystack as never,
      audit as never,
      { get: (k: string) => env[k] } as never,
    );
  });

  it('recognises only event references', () => {
    expect(sut.isEventReference('ebevt_abc')).toBe(true);
    expect(sut.isEventReference('ebgrp_abc')).toBe(false);
    expect(sut.isEventReference(undefined)).toBe(false);
  });

  it('applies a payment with the configured cap (₦500,000 by default)', async () => {
    await sut.applyPayment('ebevt_1', 525_000, '123');
    expect(repository.confirmCashGift).toHaveBeenCalledWith(
      'ebevt_1',
      525_000,
      '123',
      50_000_000,
    );

    env.EVENT_CASH_CAP_KOBO = '0';
    await sut.applyPayment('ebevt_1', 525_000, '123');
    expect(repository.confirmCashGift).toHaveBeenLastCalledWith(
      'ebevt_1',
      525_000,
      '123',
      0,
    );
  });

  it.each(['late', 'over_cap'])(
    'queues a refund straight away when the gift is %s',
    async (result) => {
      repository.confirmCashGift.mockResolvedValue(result);
      const kick = jest
        .spyOn(sut, 'kickRefunds')
        .mockImplementation(() => undefined);

      await sut.applyPayment('ebevt_1', 525_000, '123');

      expect(kick).toHaveBeenCalled();
    },
  );

  it('records a payment that can never apply instead of failing the webhook forever', async () => {
    repository.confirmCashGift.mockRejectedValue(
      new Error('event_gift_amount_mismatch'),
    );

    await expect(
      sut.applyPayment('ebevt_1', 1, '123'),
    ).resolves.toBeUndefined();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'event.payment_unmatched' }),
    );
  });

  it('lets Paystack redeliver after a transient database error', async () => {
    repository.confirmCashGift.mockRejectedValue(new Error('connection reset'));
    await expect(sut.applyPayment('ebevt_1', 525_000, '123')).rejects.toThrow(
      'connection reset',
    );
  });

  it('sends a claimed refund to Paystack and records it', async () => {
    await expect(sut.processRefunds()).resolves.toEqual({ sent: 1, failed: 0 });
    expect(paystack.createRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionReference: 'ebevt_1',
        amountKobo: 525_000,
      }),
    );
    expect(repository.refundSubmitted).toHaveBeenCalledWith('gift-1', 'rfnd_1');
  });

  it('puts a refund back in the queue after a network error', async () => {
    paystack.createRefund.mockRejectedValue(new Error('timeout'));

    await expect(sut.processRefunds()).resolves.toEqual({ sent: 0, failed: 0 });
    expect(repository.refundNotSent).toHaveBeenCalledWith(
      'gift-1',
      1,
      expect.stringContaining('timeout'),
      false,
    );
  });

  it('closes events once the giving window (date + 3 days, Lagos) has ended', async () => {
    // 16 Dec, 11:00 in Lagos: a 12 Dec event closed at 23:59 on 15 Dec.
    await expect(
      sut.closeFinished(new Date('2026-12-16T10:00:00Z')),
    ).resolves.toBe(1);
    expect(repository.activeOnOrBefore).toHaveBeenCalledWith('2026-12-12', 100);
    expect(repository.close).toHaveBeenCalledWith('event-1', 'cron');
  });
});

describe('event dates (Lagos, UTC+1)', () => {
  it('closes giving at 23:59 three days after, and sends gifts at 09:00 the next morning', () => {
    expect(givingClosesAt('2026-12-12').toISOString()).toBe(
      '2026-12-15T22:59:00.000Z',
    );
    expect(giftsSendAt('2026-12-12').toISOString()).toBe(
      '2026-12-13T08:00:00.000Z',
    );
  });
});
