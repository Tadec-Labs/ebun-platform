import { BadRequestException, ConflictException } from '@nestjs/common';
import { EventsService, makeSlug } from './events.service';
import type {
  CashGiftRow,
  EventRow,
  EventsRepository,
} from './events.repository';
import { givingClosesAt, giftsSendAt, lagosToday } from './events.config';

const DAY = 86_400_000;

function isoDay(offsetDays: number): string {
  const today = lagosToday();
  return new Date(Date.parse(`${today}T00:00:00Z`) + offsetDays * DAY)
    .toISOString()
    .slice(0, 10);
}

function event(overrides: Partial<EventRow> = {}): EventRow {
  return {
    id: 'event-1',
    slug: 'tola-and-dayo-k3f9q',
    host_token: '11111111-1111-4111-8111-111111111111',
    host_id: 'host-1',
    host_name: 'Tola Ade',
    host_phone: '+2348011111111',
    event_type: 'wedding',
    title: 'Tola & Dayo',
    event_date: isoDay(10),
    city: 'Akure',
    gift_list_enabled: true,
    cash_enabled: true,
    wall_enabled: true,
    show_amounts: false,
    status: 'active',
    cash_raised: 0,
    cash_count: 0,
    verified_at: null,
    payout_bank_code: null,
    payout_account_number: null,
    payout_account_name: null,
    payout_status: 'none',
    payout_amount: null,
    payout_reference: null,
    paid_out_at: null,
    closed_at: null,
    cancelled_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function cashGift(overrides: Partial<CashGiftRow> = {}): CashGiftRow {
  return {
    id: 'cash-1',
    event_id: 'event-1',
    guest_name: 'Uncle Femi',
    guest_phone: '+447700900123',
    message: 'Enjoy every minute!',
    show_on_wall: true,
    show_amount: true,
    amount: 500_000,
    service_fee: 25_000,
    total_amount: 525_000,
    paystack_reference: 'ebevt_1',
    status: 'confirmed',
    confirmed_at: '2026-12-12T14:00:00Z',
    refund_status: null,
    refund_amount: null,
    refund_attempts: 0,
    refund_error: null,
    thanked_at: null,
    created_at: '2026-12-12T13:59:00Z',
    ...overrides,
  };
}

describe('EventsService', () => {
  let repository: Record<string, jest.Mock>;
  let groupGifts: Record<string, jest.Mock>;
  let groupFunding: { kickRefunds: jest.Mock };
  let funding: { capKobo: jest.Mock; kickRefunds: jest.Mock };
  let paystack: { initializeTransaction: jest.Mock };
  let audit: { record: jest.Mock };
  let env: Record<string, string | undefined>;
  let sut: EventsService;

  beforeEach(() => {
    repository = {
      create: jest
        .fn()
        .mockImplementation((row: Partial<EventRow>) =>
          Promise.resolve(event(row)),
        ),
      findBySlug: jest.fn().mockResolvedValue(event()),
      findById: jest.fn().mockResolvedValue(event()),
      update: jest.fn().mockResolvedValue(event()),
      setPayoutAccount: jest.fn().mockResolvedValue(true),
      verify: jest.fn().mockResolvedValue(true),
      cancel: jest.fn().mockResolvedValue(2),
      recordPayout: jest.fn().mockResolvedValue(true),
      createCashGift: jest
        .fn()
        .mockImplementation((row: Partial<CashGiftRow>) =>
          Promise.resolve(cashGift({ ...row, status: 'pending' })),
        ),
      markCashGiftFailed: jest.fn().mockResolvedValue(undefined),
      confirmedCashGifts: jest.fn().mockResolvedValue([]),
      markCashThanked: jest.fn().mockResolvedValue(true),
      listForOps: jest.fn().mockResolvedValue([]),
    };
    groupGifts = {
      eventPots: jest.fn().mockResolvedValue([]),
      eventShares: jest.fn().mockResolvedValue([]),
      createForEvent: jest.fn().mockImplementation((p: { eventId: string }) =>
        Promise.resolve({
          id: 'pot-1',
          token: 'share-token',
          organiser_token: 'org-token',
          gift_template_id: 'template-1',
          status: 'open',
          target_amount: 3_000_000,
          amount_raised: 0,
          contributor_count: 0,
          event_id: p.eventId,
        }),
      ),
      removeEventItem: jest.fn().mockResolvedValue({ refunds: 0 }),
      markEventShareThanked: jest.fn().mockResolvedValue(true),
    };
    groupFunding = { kickRefunds: jest.fn() };
    funding = {
      capKobo: jest.fn().mockReturnValue(50_000_000),
      kickRefunds: jest.fn(),
    };
    paystack = {
      initializeTransaction: jest
        .fn()
        .mockResolvedValue({ authorizationUrl: 'https://checkout/evt' }),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    env = { EVENTS: 'true', EVENTS_CASH: 'true' };

    sut = new EventsService(
      repository as unknown as EventsRepository,
      groupGifts as never,
      groupFunding as never,
      {
        findById: jest.fn().mockResolvedValue({
          id: 'template-1',
          name: 'Home grocery restock',
          description: null,
          image_url: null,
          delivery_type: 'physical',
        }),
      } as never,
      {
        findOrCreateGuestSender: jest.fn().mockResolvedValue({ id: 'host-1' }),
      } as never,
      {
        serviceFeeFor: jest.fn((amount: number) =>
          Math.min(150_000, Math.round(amount * 0.05)),
        ),
        servicePolicy: jest
          .fn()
          .mockReturnValue({ rateBps: 500, minKobo: 20_000, maxKobo: 150_000 }),
      } as never,
      paystack as never,
      funding as never,
      audit as never,
      { get: (key: string) => env[key] } as never,
    );
  });

  describe('create', () => {
    const base = {
      eventType: 'wedding' as const,
      title: 'Tola & Dayo',
      eventDate: isoDay(30),
      city: 'Akure',
      hostName: 'Tola Ade',
      hostEmail: 'tola@example.com',
      hostPhone: '+2348011111111',
    };

    it('returns a readable public link and a separate private host link', async () => {
      const result = await sut.create(base);

      expect(result.sharePath).toMatch(/^\/e\/tola-and-dayo-[a-z2-9]{5}$/);
      expect(result.managePath).toMatch(/^\/e\/manage\/[0-9a-f-]{36}$/);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          cash_enabled: false,
          gift_list_enabled: true,
        }),
      );
    });

    it('never shows amounts at a remembrance, whatever was asked', async () => {
      await sut.create({
        ...base,
        eventType: 'remembrance',
        showAmounts: true,
      });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ show_amounts: false }),
      );
    });

    it('tries a new link when the first one is taken', async () => {
      repository.create
        .mockRejectedValueOnce({ code: '23505' })
        .mockImplementationOnce((row: Partial<EventRow>) =>
          Promise.resolve(event(row)),
        );

      await sut.create(base);

      expect(repository.create).toHaveBeenCalledTimes(2);
      const [first] = repository.create.mock.calls[0] as [{ slug: string }];
      const [second] = repository.create.mock.calls[1] as [{ slug: string }];
      expect(first.slug).not.toBe(second.slug);
    });

    it.each([
      ['a date in the past', isoDay(-1)],
      ['more than a year ahead', isoDay(400)],
      ['a date that does not exist', '2027-02-30'],
    ])('refuses %s', async (_label, eventDate) => {
      await expect(sut.create({ ...base, eventDate })).rejects.toThrow(
        BadRequestException,
      );
      expect(repository.create).not.toHaveBeenCalled();
    });
  });

  describe('giveCash', () => {
    const dto = {
      name: 'Uncle Femi',
      email: 'femi@example.com',
      amountNaira: 5000,
    };

    it('adds the service fee and opens a checkout that returns to the event page', async () => {
      const result = await sut.giveCash('tola-and-dayo-k3f9q', dto);

      expect(result).toEqual({
        checkoutUrl: 'https://checkout/evt',
        amount: 500_000,
        serviceFee: 25_000,
        total: 525_000,
      });
      const [checkout] = paystack.initializeTransaction.mock.calls[0] as [
        { amountKobo: number; reference: string; callbackPath: string },
      ];
      expect(checkout.amountKobo).toBe(525_000);
      expect(checkout.reference).toMatch(/^ebevt_[0-9a-f-]{36}$/);
      expect(checkout.callbackPath).toBe('/e/tola-and-dayo-k3f9q?paid=1');
      // Defaults: on the wall, amount hidden.
      expect(repository.createCashGift).toHaveBeenCalledWith(
        expect.objectContaining({ show_on_wall: true, show_amount: false }),
      );
    });

    it.each([
      ['SendEbun has cash switched off', () => (env.EVENTS_CASH = undefined)],
      [
        'the host turned cash off',
        () =>
          repository.findBySlug.mockResolvedValue(
            event({ cash_enabled: false }),
          ),
      ],
      [
        'the event has closed',
        () =>
          repository.findBySlug.mockResolvedValue(event({ status: 'closed' })),
      ],
      [
        'the giving window has passed',
        () =>
          repository.findBySlug.mockResolvedValue(
            event({ event_date: isoDay(-5) }),
          ),
      ],
    ])('refuses when %s', async (_label, arrange) => {
      arrange();
      await expect(sut.giveCash('tola-and-dayo-k3f9q', dto)).rejects.toThrow(
        ConflictException,
      );
      expect(paystack.initializeTransaction).not.toHaveBeenCalled();
    });

    it("refuses a gift that would take an unverified host's event over the cap", async () => {
      repository.findBySlug.mockResolvedValue(
        event({ cash_raised: 49_800_000 }),
      );

      await expect(sut.giveCash('tola-and-dayo-k3f9q', dto)).rejects.toThrow(
        /verified/,
      );
      expect(repository.createCashGift).not.toHaveBeenCalled();
    });

    it('has no cap once ops has verified the host', async () => {
      repository.findBySlug.mockResolvedValue(
        event({ cash_raised: 49_800_000, verified_at: '2026-12-01T00:00:00Z' }),
      );

      await expect(
        sut.giveCash('tola-and-dayo-k3f9q', dto),
      ).resolves.toBeDefined();
    });

    it('marks the gift failed when Paystack never opens a checkout', async () => {
      paystack.initializeTransaction.mockRejectedValue(new Error('down'));

      await expect(sut.giveCash('tola-and-dayo-k3f9q', dto)).rejects.toThrow(
        'down',
      );
      expect(repository.markCashGiftFailed).toHaveBeenCalledWith('cash-1');
    });
  });

  describe('wall', () => {
    it('shows names and lines, never contact details, and amounts only when host and guest both allow', async () => {
      repository.confirmedCashGifts.mockResolvedValue([
        cashGift(),
        cashGift({ id: 'cash-2', guest_name: 'Kemi', show_amount: false }),
      ]);
      groupGifts.eventPots.mockResolvedValue([
        { id: 'pot-1', gift_template_id: 'template-1' },
      ]);
      groupGifts.eventShares.mockResolvedValue([
        {
          id: 'share-1',
          group_gift_id: 'pot-1',
          contributor_name: 'Bisi Ola',
          contributor_phone: '+2348022222222',
          amount: 1_000_000,
          message: 'Private note for the couple',
          confirmed_at: '2026-12-12T15:00:00Z',
          thanked_at: null,
        },
      ]);

      const hidden = await sut.wall('tola-and-dayo-k3f9q');
      expect(hidden.entries.every((e) => e.amount === null)).toBe(true);

      repository.findBySlug.mockResolvedValue(event({ show_amounts: true }));
      const { entries } = await sut.wall('tola-and-dayo-k3f9q');
      const json = JSON.stringify(entries);

      expect(entries[0]).toEqual(
        expect.objectContaining({
          kind: 'gift',
          name: 'Bisi',
          message: null,
          giftName: 'Home grocery restock',
        }),
      );
      expect(entries.find((e) => e.id === 'cash-1')?.amount).toBe(500_000);
      expect(entries.find((e) => e.id === 'cash-2')?.amount).toBeNull();
      expect(json).not.toContain('+234');
      expect(json).not.toContain('+44');
      expect(json).not.toContain('Private note');
      expect(repository.confirmedCashGifts).toHaveBeenCalledWith(
        'event-1',
        30,
        true,
      );
    });

    it('is empty when the host turned the wall off', async () => {
      repository.findBySlug.mockResolvedValue(event({ wall_enabled: false }));
      repository.confirmedCashGifts.mockResolvedValue([cashGift()]);

      await expect(sut.wall('tola-and-dayo-k3f9q')).resolves.toEqual({
        entries: [],
      });
    });
  });

  describe('host', () => {
    it('never sends the full account number back, and merges cash and gift-list thank-yous', async () => {
      env.EVENT_HOST_FEE_BPS = '200';
      const host = event({
        cash_raised: 1_000_000,
        cash_count: 2,
        payout_account_number: '0123456789',
        payout_account_name: 'TOLA ADE',
        payout_bank_code: '058',
      });
      repository.confirmedCashGifts.mockResolvedValue([cashGift()]);

      const view = await sut.hostView(host);

      expect(view.payout.accountNumberMasked).toBe('••6789');
      expect(JSON.stringify(view)).not.toContain('0123456789');
      expect(view.payoutDue).toBe(980_000);
      expect(view.thankYous).toEqual([
        expect.objectContaining({
          kind: 'cash',
          name: 'Uncle Femi',
          thanked: false,
        }),
      ]);
    });

    it('keeps amounts off at a remembrance even if the host asks', async () => {
      await sut.update(event({ event_type: 'remembrance' }), {
        showAmounts: true,
      });

      expect(repository.update).toHaveBeenCalledWith('event-1', {
        show_amounts: false,
      });
    });

    it('records that the payout account changed without recording the account', async () => {
      await sut.setPayoutAccount(event(), {
        bankCode: '058',
        accountNumber: '0123456789',
        accountName: 'TOLA ADE',
      });

      expect(JSON.stringify(audit.record.mock.calls)).not.toContain(
        '0123456789',
      );
    });

    it('adds gift-list items that close with the event and reach the host the morning after', async () => {
      const host = event({ event_date: '2026-12-12' });

      const item = await sut.addItem(host, { giftTemplateId: 'template-1' });

      expect(groupGifts.createForEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: 'event-1',
          recipientPhone: '+2348011111111',
          deadline: givingClosesAt('2026-12-12'),
          sendAt: giftsSendAt('2026-12-12'),
        }),
      );
      expect(item).toEqual(
        expect.objectContaining({ token: 'share-token', status: 'open' }),
      );
    });

    it('refunds everyone when the host cancels', async () => {
      await expect(sut.cancel(event(), 'Plans changed')).resolves.toEqual({
        refunds: 2,
      });
      expect(funding.kickRefunds).toHaveBeenCalled();
      expect(groupFunding.kickRefunds).toHaveBeenCalled();
    });

    it("can't cancel once paid out", async () => {
      repository.cancel.mockResolvedValue(-1);
      await expect(sut.cancel(event(), 'x')).rejects.toThrow(ConflictException);
    });
  });

  describe('ops payout', () => {
    it('pays out what was raised less the host fee', async () => {
      env.EVENT_HOST_FEE_BPS = '100';
      repository.findById.mockResolvedValue(event({ cash_raised: 2_000_000 }));

      await expect(
        sut.recordPayout('event-1', 'TRF-123', { userId: 'staff-1' } as never),
      ).resolves.toEqual({ amount: 1_980_000 });
      expect(repository.recordPayout).toHaveBeenCalledWith(
        'event-1',
        1_980_000,
        'TRF-123',
        'staff-1',
      );
    });

    it('explains why a payout is refused', async () => {
      repository.recordPayout.mockRejectedValue(
        new Error('event_not_verified'),
      );
      await expect(
        sut.recordPayout('event-1', 'TRF-123', { userId: 'staff-1' } as never),
      ).rejects.toThrow(/Verify/);
    });
  });
});

describe('makeSlug', () => {
  it('reads well and ends in a random suffix', () => {
    expect(makeSlug('Tola & Dayo')).toMatch(/^tola-and-dayo-[a-z2-9]{5}$/);
    expect(makeSlug('Ẹ̀bùn Àdùnní at 60!')).toMatch(
      /^ebun-adunni-at-60-[a-z2-9]{5}$/,
    );
    expect(makeSlug('***')).toMatch(/^event-[a-z2-9]{5}$/);
    expect(makeSlug('Tola & Dayo')).not.toBe(makeSlug('Tola & Dayo'));
  });
});
