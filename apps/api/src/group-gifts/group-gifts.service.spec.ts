import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { FulfillmentType } from '@ebun/types';
import { GroupGiftsService } from './group-gifts.service';
import type {
  ContributionRow,
  GroupGiftRow,
  GroupGiftsRepository,
} from './group-gifts.repository';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function pot(overrides: Partial<GroupGiftRow> = {}): GroupGiftRow {
  return {
    id: 'pot-1',
    gift_template_id: 'template-1',
    organiser_id: 'organiser-1',
    recipient_name: 'Tolu Adebayo',
    recipient_phone: '+2348011111111',
    target_amount: 5_000_000,
    amount_raised: 2_000_000,
    contributor_count: 2,
    status: 'open',
    deadline: new Date(Date.now() + 2 * DAY).toISOString(),
    token: 'share-token',
    organiser_token: 'organiser-token',
    reveal_theme: 'gold',
    sender_message: null,
    linked_order_id: null,
    gift_value: 5_000_000,
    delivery_fee: 0,
    send_at: null,
    show_amounts: false,
    deadline_extended: false,
    funded_at: null,
    closed_at: null,
    close_reason: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function contribution(
  overrides: Partial<ContributionRow> = {},
): ContributionRow {
  return {
    id: 'c-1',
    group_gift_id: 'pot-1',
    contributor_name: 'Bisi Ola',
    contributor_email: 'bisi@example.com',
    contributor_phone: '+2348022222222',
    amount: 1_000_000,
    service_fee: 50_000,
    total_amount: 1_050_000,
    message: 'Happy birthday!',
    paystack_reference: 'ebgrp_1',
    status: 'confirmed',
    confirmed_at: new Date().toISOString(),
    refund_status: null,
    refund_amount: null,
    refund_attempts: 0,
    refund_error: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('GroupGiftsService', () => {
  let sut: GroupGiftsService;
  let repository: jest.Mocked<
    Pick<
      GroupGiftsRepository,
      | 'create'
      | 'findByToken'
      | 'contributions'
      | 'createContribution'
      | 'markContributionFailed'
      | 'extend'
      | 'switchGift'
      | 'close'
      | 'orderRevealToken'
      | 'findById'
    >
  >;
  let gifts: { findAvailableById: jest.Mock; findById: jest.Mock };
  let users: { findOrCreateGuestSender: jest.Mock; findById: jest.Mock };
  let pricing: {
    priceGift: jest.Mock;
    serviceFeeFor: jest.Mock;
    servicePolicy: jest.Mock;
  };
  let paystack: { initializeTransaction: jest.Mock };
  let funding: { afterFunded: jest.Mock; kickRefunds: jest.Mock };
  let audit: { record: jest.Mock };

  beforeEach(() => {
    repository = {
      create: jest
        .fn()
        .mockImplementation((row: Partial<GroupGiftRow>) =>
          Promise.resolve(pot(row)),
        ),
      findByToken: jest.fn().mockResolvedValue(pot()),
      contributions: jest.fn().mockResolvedValue([]),
      createContribution: jest
        .fn()
        .mockImplementation((row: Partial<ContributionRow>) =>
          Promise.resolve(contribution({ ...row, status: 'pending' })),
        ),
      markContributionFailed: jest.fn().mockResolvedValue(undefined),
      extend: jest.fn().mockResolvedValue(true),
      switchGift: jest.fn().mockResolvedValue('order-9'),
      close: jest.fn().mockResolvedValue(2),
      orderRevealToken: jest.fn().mockResolvedValue('reveal-9'),
      findById: jest.fn().mockResolvedValue(pot()),
    };
    const template = {
      id: 'template-1',
      name: 'Pamper Session',
      description: null,
      image_url: null,
      delivery_type: FulfillmentType.Physical,
      base_price: 4_850_000,
    };
    gifts = {
      findAvailableById: jest.fn().mockResolvedValue(template),
      findById: jest.fn().mockResolvedValue(template),
    };
    users = {
      findOrCreateGuestSender: jest
        .fn()
        .mockResolvedValue({ id: 'organiser-1' }),
      findById: jest
        .fn()
        .mockResolvedValue({ id: 'organiser-1', name: 'Ada Obi' }),
    };
    pricing = {
      priceGift: jest.fn().mockImplementation((value: number) => ({
        giftValue: value,
        deliveryFee: 150_000,
        serviceFee: 150_000,
        total: value + 300_000,
      })),
      servicePolicy: jest
        .fn()
        .mockReturnValue({ rateBps: 500, minKobo: 30_000, maxKobo: 150_000 }),
      // 5%, floor ₦300 — the numbers-sheet policy.
      serviceFeeFor: jest
        .fn()
        .mockImplementation((amount: number) =>
          Math.max(30_000, Math.ceil(amount * 0.0005) * 100),
        ),
    };
    paystack = {
      initializeTransaction: jest
        .fn()
        .mockResolvedValue({ authorizationUrl: 'https://checkout/abc' }),
    };
    funding = { afterFunded: jest.fn(), kickRefunds: jest.fn() };
    audit = { record: jest.fn().mockResolvedValue(undefined) };

    sut = new GroupGiftsService(
      repository as unknown as GroupGiftsRepository,
      gifts as never,
      users as never,
      pricing as never,
      paystack as never,
      funding as never,
      audit as never,
      { get: () => 'true' } as never,
    );
  });

  describe('create', () => {
    const base = {
      giftTemplateId: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
      organiserName: 'Ada Obi',
      organiserEmail: 'ada@example.com',
      recipientName: 'Tolu Adebayo',
      recipientPhone: '+2348011111111',
    };

    it('targets the gift and delivery at catalogue price — the sender fee is charged per share, not here', async () => {
      const result = await sut.create({
        ...base,
        deadline: new Date(Date.now() + 3 * DAY).toISOString(),
      });

      expect(result.targetAmount).toBe(4_850_000 + 150_000);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          target_amount: 5_000_000,
          gift_value: 4_850_000,
          delivery_fee: 150_000,
          show_amounts: false,
        }),
      );
      expect(result.sharePath).toBe('/group/share-token');
      expect(result.managePath).toBe('/group/manage/organiser-token');
    });

    it('needs at least an hour for people to chip in', async () => {
      await expect(
        sut.create({
          ...base,
          deadline: new Date(Date.now() + 30 * 60_000).toISOString(),
        }),
      ).rejects.toThrow(BadRequestException);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('refuses a deadline more than 30 days away', async () => {
      await expect(
        sut.create({
          ...base,
          deadline: new Date(Date.now() + 31 * DAY).toISOString(),
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('publicView', () => {
    it('shows first names only, no phone numbers, no messages, and hides amounts by default', async () => {
      repository.contributions.mockResolvedValue([
        contribution(),
        contribution({
          id: 'c-2',
          status: 'late',
          contributor_name: 'Late Larry',
        }),
      ]);

      const view = await sut.publicView('share-token');
      const json = JSON.stringify(view);

      expect(view.recipientFirstName).toBe('Tolu');
      expect(view.organiserFirstName).toBe('Ada');
      expect(view.contributors).toEqual([{ name: 'Bisi', amount: null }]);
      expect(json).not.toContain('+234');
      expect(json).not.toContain('Happy birthday');
      expect(view.remaining).toBe(3_000_000);
      // The page shows each share's fee from the same rule the API charges.
      expect(view.serviceFee).toEqual({
        rateBps: 500,
        minKobo: 30_000,
        maxKobo: 150_000,
      });
    });

    it('shows amounts when the organiser chose to', async () => {
      repository.findByToken.mockResolvedValue(pot({ show_amounts: true }));
      repository.contributions.mockResolvedValue([contribution()]);

      const view = await sut.publicView('share-token');

      expect(view.contributors).toEqual([{ name: 'Bisi', amount: 1_000_000 }]);
    });

    it('says the organiser has a decision to make once the deadline passes', async () => {
      repository.findByToken.mockResolvedValue(
        pot({ deadline: new Date(Date.now() - HOUR).toISOString() }),
      );
      expect((await sut.publicView('share-token')).status).toBe(
        'awaiting_organiser',
      );
    });

    it('404s an unknown link', async () => {
      repository.findByToken.mockResolvedValue(null);
      await expect(sut.publicView('nope')).rejects.toThrow(NotFoundException);
    });
  });

  describe('contribute', () => {
    const share = {
      name: 'Bisi Ola',
      email: 'bisi@example.com',
      message: 'Hi',
    };

    it('charges the share plus its own fee, and only the webhook will count it', async () => {
      const result = await sut.contribute('share-token', {
        ...share,
        amountNaira: 10_000,
      });

      expect(result).toEqual({
        checkoutUrl: 'https://checkout/abc',
        amount: 1_000_000,
        serviceFee: 50_000,
        total: 1_050_000,
      });
      const row = repository.createContribution.mock.calls[0][0];
      expect(row.paystack_reference).toMatch(/^ebgrp_/);
      expect(paystack.initializeTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          amountKobo: 1_050_000,
          reference: row.paystack_reference,
          callbackPath: '/group/share-token?paid=1',
        }),
      );
    });

    it('refuses more than is left to reach the target', async () => {
      await expect(
        sut.contribute('share-token', { ...share, amountNaira: 30_001 }),
      ).rejects.toThrow(BadRequestException);
      expect(repository.createContribution).not.toHaveBeenCalled();
    });

    it('refuses a share under ₦1,000 — unless that is all that is left', async () => {
      await expect(
        sut.contribute('share-token', { ...share, amountNaira: 500 }),
      ).rejects.toThrow(BadRequestException);

      repository.findByToken.mockResolvedValue(
        pot({ amount_raised: 5_000_000 - 50_000 }),
      );
      await expect(
        sut.contribute('share-token', { ...share, amountNaira: 500 }),
      ).resolves.toMatchObject({ amount: 50_000 });
    });

    it('still takes shares after the deadline while the organiser decides — that is how a pot gets finished', async () => {
      repository.findByToken.mockResolvedValue(
        pot({ deadline: new Date(Date.now() - 2 * HOUR).toISOString() }),
      );
      await expect(
        sut.contribute('share-token', { ...share, amountNaira: 5_000 }),
      ).resolves.toMatchObject({ amount: 500_000 });
    });

    it('refuses a pot that is funded, closed, or past its decision window', async () => {
      repository.findByToken.mockResolvedValueOnce(
        pot({ status: 'triggered' }),
      );
      await expect(
        sut.contribute('share-token', { ...share, amountNaira: 5_000 }),
      ).rejects.toThrow(ConflictException);

      repository.findByToken.mockResolvedValueOnce(
        pot({ status: 'cancelled' }),
      );
      await expect(
        sut.contribute('share-token', { ...share, amountNaira: 5_000 }),
      ).rejects.toThrow(ConflictException);

      repository.findByToken.mockResolvedValueOnce(
        pot({ deadline: new Date(Date.now() - 49 * HOUR).toISOString() }),
      );
      await expect(
        sut.contribute('share-token', { ...share, amountNaira: 5_000 }),
      ).rejects.toThrow(ConflictException);
    });

    it('marks the share failed when Paystack never opened a checkout', async () => {
      paystack.initializeTransaction.mockRejectedValue(new Error('down'));

      await expect(
        sut.contribute('share-token', { ...share, amountNaira: 5_000 }),
      ).rejects.toThrow('down');
      expect(repository.markContributionFailed).toHaveBeenCalledWith('c-1');
    });

    it('is closed while the flag is off', () => {
      const off = new GroupGiftsService(
        repository as unknown as GroupGiftsRepository,
        gifts as never,
        users as never,
        pricing as never,
        paystack as never,
        funding as never,
        audit as never,
        { get: () => undefined } as never,
      );
      expect(off.isEnabled()).toBe(false);
    });
  });

  describe('contributionStatus', () => {
    it("answers for a share of this pot, and nothing for another pot's", async () => {
      (repository as unknown as Record<string, jest.Mock>).contributionStatus =
        jest
          .fn()
          .mockResolvedValueOnce('confirmed')
          .mockResolvedValueOnce(null);

      await expect(
        sut.contributionStatus('share-token', 'ebgrp_1'),
      ).resolves.toEqual({ status: 'confirmed' });
      await expect(
        sut.contributionStatus('share-token', 'ebgrp_other'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('organiser decisions', () => {
    it('extends once, by up to 7 days past the current deadline', async () => {
      const current = pot();
      const tooFar = new Date(
        new Date(current.deadline).getTime() + 8 * DAY,
      ).toISOString();
      await expect(sut.extend(current, { deadline: tooFar })).rejects.toThrow(
        BadRequestException,
      );

      const ok = new Date(
        new Date(current.deadline).getTime() + 3 * DAY,
      ).toISOString();
      await sut.extend(current, { deadline: ok });
      expect(repository.extend).toHaveBeenCalledWith('pot-1', ok);

      await expect(
        sut.extend(pot({ deadline_extended: true }), { deadline: ok }),
      ).rejects.toThrow(ConflictException);
    });

    it('switches only to a gift the pot already covers, then starts it', async () => {
      // 4.85M + 0.15M delivery = 5M > 2M raised.
      await expect(
        sut.switchGift(pot(), {
          giftTemplateId: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(repository.switchGift).not.toHaveBeenCalled();

      gifts.findAvailableById.mockResolvedValue({
        id: 'template-2',
        delivery_type: FulfillmentType.DigitalVoucher,
        base_price: 1_500_000,
      });
      const result = await sut.switchGift(pot(), {
        giftTemplateId: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
      });

      expect(repository.switchGift).toHaveBeenCalledWith(
        'pot-1',
        'template-2',
        1_500_000,
        150_000,
      );
      expect(funding.afterFunded).toHaveBeenCalledWith('pot-1', 'order-9');
      // 2M raised, 1.65M gift: the 0.35M surplus goes back now.
      expect(funding.kickRefunds).toHaveBeenCalled();
      expect(result.revealPath).toBe('/reveal/reveal-9');
    });

    it('cancels an open pot and starts the refunds straight away', async () => {
      await expect(sut.cancel(pot())).resolves.toEqual({ refunds: 2 });
      expect(repository.close).toHaveBeenCalledWith(
        'pot-1',
        'cancelled',
        expect.any(String),
        'user',
      );
      expect(funding.kickRefunds).toHaveBeenCalled();
    });

    it("refuses to cancel a pot that's no longer collecting", async () => {
      repository.close.mockResolvedValue(-1);
      await expect(sut.cancel(pot({ status: 'triggered' }))).rejects.toThrow(
        ConflictException,
      );
      expect(funding.kickRefunds).not.toHaveBeenCalled();
    });

    it('gives the organiser the reveal link once the pot became a gift', async () => {
      const view = await sut.organiserView(
        pot({ status: 'triggered', linked_order_id: 'order-9' }),
      );
      expect(view.revealPath).toBe('/reveal/reveal-9');
      expect(view.canCancel).toBe(false);
    });
  });

  describe('revealInfo', () => {
    it('lists who paid for the gift and their lines, leaving out refunded late payers', async () => {
      repository.contributions.mockResolvedValue([
        contribution(),
        contribution({ id: 'c-2', status: 'late', contributor_name: 'Late' }),
      ]);

      const info = await sut.revealInfo('pot-1');

      expect(info).toEqual({
        organiserName: 'Ada Obi',
        contributorCount: 1,
        contributors: [{ name: 'Bisi Ola', message: 'Happy birthday!' }],
      });
    });
  });
});
