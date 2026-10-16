import { BadGatewayException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FulfillmentType, OrderStatus } from '@ebun/types';
import { AuditService } from '../audit/audit.service';
import { GiftsService } from '../gifts/gifts.service';
import { MessageMediaService } from '../media/message-media.service';
import { PaystackClientService } from '../paystack/paystack-client.service';
import { PricingService } from '../pricing/pricing.service';
import {
  CampaignOrderRow,
  CampaignRow,
  CampaignsRepository,
} from './campaigns.repository';
import { CampaignsService, stageOf } from './campaigns.service';

const DELIVERY = 150_000;

function campaign(over: Partial<CampaignRow> = {}): CampaignRow {
  return {
    id: 'c1',
    lead_id: null,
    company_name: 'Acme Ltd',
    contact_name: 'Bola',
    contact_email: 'hr@acme.ng',
    contact_phone: null,
    title: 'Thank you',
    sender_display_name: 'Ada Obi, CEO',
    message_text: 'Thank you for a great year.',
    message_type: 'text',
    message_url: null,
    message_duration_secs: null,
    send_at: null,
    gift_days: 30,
    fee_bps: 1000,
    status: 'draft',
    portal_token: '11111111-1111-4111-8111-111111111111',
    recipients_count: null,
    seat_price: null,
    gift_total: null,
    fee_amount: null,
    amount_due: null,
    paystack_reference: null,
    paid_at: null,
    links_sent_at: null,
    created_at: 't',
    updated_at: 't',
    ...over,
  };
}

const TEMPLATES: Record<
  string,
  {
    id: string;
    name: string;
    base_price: number;
    delivery_type: FulfillmentType;
    description: null;
    image_url: null;
  }
> = {
  lunch: {
    id: 'lunch',
    name: 'Lunch',
    base_price: 1_500_000,
    delivery_type: FulfillmentType.DigitalVoucher,
    description: null,
    image_url: null,
  },
  hamper: {
    id: 'hamper',
    name: 'Hamper',
    base_price: 2_000_000,
    delivery_type: FulfillmentType.Physical,
    description: null,
    image_url: null,
  },
  airtime: {
    id: 'airtime',
    name: 'Airtime',
    base_price: 100_000,
    delivery_type: FulfillmentType.Vtu,
    description: null,
    image_url: null,
  },
};

describe('CampaignsService', () => {
  let repo: Record<string, jest.Mock>;
  let gifts: {
    findById: jest.Mock;
    findAvailableById: jest.Mock;
    listAvailable: jest.Mock;
  };
  let paystack: { initializeTransaction: jest.Mock };
  let audit: { record: jest.Mock };
  let sut: CampaignsService;

  beforeEach(() => {
    repo = {
      options: jest.fn().mockResolvedValue([
        {
          campaign_id: 'c1',
          gift_template_id: 'lunch',
          position: 0,
          gift_value: null,
          delivery_fee: null,
        },
        {
          campaign_id: 'c1',
          gift_template_id: 'hamper',
          position: 1,
          gift_value: null,
          delivery_fee: null,
        },
      ]),
      countRecipients: jest.fn().mockResolvedValue(100),
      update: jest.fn((id: string, changes: Partial<CampaignRow>) =>
        Promise.resolve(campaign({ ...changes })),
      ),
      snapshotOptionPrice: jest.fn().mockResolvedValue(undefined),
      replaceOptions: jest.fn().mockResolvedValue(undefined),
      addRecipients: jest.fn().mockResolvedValue(2),
      recipients: jest.fn().mockResolvedValue([]),
      orders: jest.fn().mockResolvedValue([]),
    };
    gifts = {
      findById: jest.fn((id: string) => Promise.resolve(TEMPLATES[id])),
      findAvailableById: jest.fn((id: string) =>
        Promise.resolve(TEMPLATES[id]),
      ),
      listAvailable: jest.fn(),
    };
    paystack = {
      initializeTransaction: jest
        .fn()
        .mockResolvedValue({ authorizationUrl: 'https://paystack/checkout' }),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    const pricing = {
      priceGift: (v: number, t?: FulfillmentType) => {
        const deliveryFee = t === FulfillmentType.Physical ? DELIVERY : 0;
        return {
          giftValue: v,
          serviceFee: 0,
          deliveryFee,
          total: v + deliveryFee,
        };
      },
    };
    sut = new CampaignsService(
      repo as unknown as CampaignsRepository,
      gifts as unknown as GiftsService,
      pricing as unknown as PricingService,
      paystack as unknown as PaystackClientService,
      {
        isEnabled: () => true,
        playbackUrl: jest.fn(),
        delete: jest.fn(),
      } as unknown as MessageMediaService,
      audit as unknown as AuditService,
      { get: () => 'https://app.ebun.com.ng' } as unknown as ConfigService,
    );
  });

  it('prices every seat at the dearest option, delivery included, plus the fee', async () => {
    const view = await sut.view(campaign());
    // Hamper ₦20,000 + ₦1,500 delivery beats lunch ₦15,000.
    expect(view.quote).toEqual({
      recipients: 100,
      seatPrice: 2_150_000,
      giftTotal: 215_000_000,
      feeBps: 1000,
      fee: 21_500_000,
      amountDue: 236_500_000,
    });
    expect(view.missing).toEqual([]);
  });

  it('checkout freezes the campaign, snapshots prices, and charges exactly the quote', async () => {
    const result = await sut.checkout(campaign());

    expect(repo.snapshotOptionPrice).toHaveBeenCalledWith(
      'c1',
      'hamper',
      2_000_000,
      DELIVERY,
    );
    expect(repo.snapshotOptionPrice).toHaveBeenCalledWith(
      'c1',
      'lunch',
      1_500_000,
      0,
    );
    const [, frozen, guard] = repo.update.mock.calls[0] as [
      string,
      Partial<CampaignRow>,
      string[],
    ];
    expect(guard).toEqual(['draft']);
    expect(frozen).toMatchObject({
      status: 'awaiting_payment',
      recipients_count: 100,
      seat_price: 2_150_000,
      amount_due: 236_500_000,
    });
    expect(frozen.paystack_reference).toMatch(/^ebcmp_[0-9a-f-]{36}$/);
    expect(paystack.initializeTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'hr@acme.ng',
        amountKobo: 236_500_000,
        reference: frozen.paystack_reference,
        callbackPath: '/company',
      }),
    );
    expect(result.checkoutUrl).toBe('https://paystack/checkout');
  });

  it('unfreezes when Paystack refuses to open the checkout', async () => {
    paystack.initializeTransaction.mockRejectedValue(
      new BadGatewayException('down'),
    );

    await expect(sut.checkout(campaign())).rejects.toThrow('down');
    expect(repo.update).toHaveBeenLastCalledWith(
      'c1',
      { status: 'draft', paystack_reference: null },
      ['awaiting_payment'],
    );
  });

  it('will not open a checkout with nobody on the list or no message', async () => {
    repo.countRecipients.mockResolvedValue(0);
    await expect(
      sut.checkout(campaign({ message_text: null })),
    ).rejects.toThrow(/Add the people.*Write or record your message/);
    expect(paystack.initializeTransaction).not.toHaveBeenCalled();
  });

  it('locks every edit once checkout has started', async () => {
    const locked = campaign({ status: 'awaiting_payment' });
    await expect(
      sut.updateDetails(locked, { title: 'New' }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(sut.setGifts(locked, ['lunch'])).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(
      sut.addRecipients(locked, 'name,phone\nA,08031234567'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses gifts a campaign cannot fulfil', async () => {
    await expect(sut.setGifts(campaign(), ['airtime'])).rejects.toThrow(
      /can't be sent in a company campaign/,
    );
    expect(repo.replaceOptions).not.toHaveBeenCalled();
  });

  it('caps a campaign at 2,000 people', async () => {
    repo.countRecipients.mockResolvedValue(1999);
    await expect(
      sut.addRecipients(campaign(), 'name,phone\nA,08031234567\nB,08031234568'),
    ).rejects.toThrow(/up to 2000 people/);
  });

  it('reports what each person did, and what the company is owed back', async () => {
    const order = (over: Partial<CampaignOrderRow>): CampaignOrderRow => ({
      id: 'o',
      status: OrderStatus.Paid,
      reveal_token: 't',
      gift_template_id: 'hamper',
      gift_value: 2_000_000,
      delivery_fee: DELIVERY,
      total_amount: 2_150_000,
      gift_chosen_at: null,
      reveal_opened_at: null,
      expires_at: '2099-01-01T00:00:00Z',
      ...over,
    });
    repo.options.mockResolvedValue([
      {
        campaign_id: 'c1',
        gift_template_id: 'lunch',
        position: 0,
        gift_value: 1_500_000,
        delivery_fee: 0,
      },
      {
        campaign_id: 'c1',
        gift_template_id: 'hamper',
        position: 1,
        gift_value: 2_000_000,
        delivery_fee: DELIVERY,
      },
    ]);
    repo.recipients.mockResolvedValue([
      {
        id: 'r1',
        name: 'Ada',
        phone: '+1',
        email: null,
        note: null,
        order_id: 'o1',
        link_sent_at: 't',
        link_send_error: null,
        thanks_note: 'Thank you!',
        thanks_at: '2026-12-24T10:00:00Z',
      },
      {
        id: 'r2',
        name: 'Bayo',
        phone: '+2',
        email: null,
        note: null,
        order_id: 'o2',
        link_sent_at: 't',
        link_send_error: null,
        thanks_note: null,
        thanks_at: null,
      },
      {
        id: 'r3',
        name: 'Chi',
        phone: '+3',
        email: null,
        note: null,
        order_id: 'o3',
        link_sent_at: null,
        link_send_error: null,
        thanks_note: null,
        thanks_at: null,
      },
    ]);
    repo.orders.mockResolvedValue([
      // Picked the cheaper lunch and collected it: ₦6,500 comes back.
      order({
        id: 'o1',
        status: OrderStatus.Redeemed,
        gift_template_id: 'lunch',
        gift_value: 1_500_000,
        delivery_fee: 0,
        gift_chosen_at: 't',
      }),
      // Never chose before the date: everything comes back.
      order({ id: 'o2', expires_at: '2020-01-01T00:00:00Z' }),
      // Not sent yet.
      order({ id: 'o3' }),
    ]);

    const report = await sut.report(campaign({ status: 'paid' }));

    expect(report.totals).toMatchObject({
      people: 3,
      used: 1,
      expired: 1,
      waiting: 1,
      thanked: 1,
    });
    expect(report.money).toEqual({
      paid: 6_450_000,
      used: 1_500_000,
      creditDue: 650_000 + 2_150_000,
    });
    expect(report.choices).toEqual([
      { giftTemplateId: 'lunch', name: 'Lunch', count: 1 },
      { giftTemplateId: 'hamper', name: 'Hamper', count: 0 },
    ]);
    expect(report.rows[0]).toMatchObject({
      stage: 'used',
      giftName: 'Lunch',
      thanks: 'Thank you!',
    });
    expect(report.rows[1]).toMatchObject({ stage: 'expired', choosing: false });
    expect(report.rows[2]).toMatchObject({ stage: 'waiting', choosing: true });
  });
});

describe('stageOf', () => {
  const now = Date.parse('2026-12-01T00:00:00Z');
  const base: CampaignOrderRow = {
    id: 'o',
    status: OrderStatus.VoucherIssued,
    reveal_token: 't',
    gift_template_id: 'g',
    gift_value: 1,
    delivery_fee: 0,
    total_amount: 1,
    gift_chosen_at: 't',
    reveal_opened_at: null,
    expires_at: '2026-12-31T00:00:00Z',
  };

  it.each([
    [undefined, null, 'not_paid'],
    [base, null, 'waiting'],
    [base, 't', 'sent'],
    [{ ...base, status: OrderStatus.RevealOpened }, 't', 'opened'],
    [{ ...base, status: OrderStatus.Dispatched }, 't', 'on_its_way'],
    [{ ...base, status: OrderStatus.Fulfilled }, 't', 'used'],
    [{ ...base, status: OrderStatus.Refunded }, 't', 'refunded'],
    [{ ...base, status: OrderStatus.FulfillmentFailed }, 't', 'problem'],
    [{ ...base, expires_at: '2026-11-01T00:00:00Z' }, 't', 'expired'],
  ] as const)('%#', (order, linkSentAt, stage) => {
    expect(
      stageOf(order, { link_sent_at: linkSentAt }, 'digital_voucher', now),
    ).toBe(stage);
  });

  it('never calls a chosen doorstep gift expired — it has been claimed', () => {
    const order = {
      ...base,
      status: OrderStatus.FulfillmentInProgress,
      expires_at: '2026-11-01T00:00:00Z',
    };
    expect(stageOf(order, { link_sent_at: 't' }, 'physical', now)).toBe('sent');
  });
});
