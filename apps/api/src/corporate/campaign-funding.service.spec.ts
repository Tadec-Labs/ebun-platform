import { OrderStatus } from '@ebun/types';
import { AuditService } from '../audit/audit.service';
import { FulfillmentOrchestratorService } from '../fulfillment/fulfillment-orchestrator.service';
import { CampaignsRepository } from './campaigns.repository';
import { CampaignFundingService } from './campaign-funding.service';
import { CampaignSendingService } from './campaign-sending.service';
import { CampaignGiftsService } from './campaign-gifts.service';
import { GiftsService } from '../gifts/gifts.service';

describe('CampaignFundingService', () => {
  let repo: Record<string, jest.Mock>;
  let fulfillment: { start: jest.Mock };
  let sending: { sendIfDue: jest.Mock };
  let audit: { record: jest.Mock };
  let sut: CampaignFundingService;

  beforeEach(() => {
    repo = {
      findByPaystackReference: jest
        .fn()
        .mockResolvedValue({ id: 'c1', company_name: 'Acme' }),
      fund: jest.fn().mockResolvedValue('funded'),
      orders: jest.fn().mockResolvedValue([
        { id: 'o1', status: OrderStatus.Paid, gift_chosen_at: 't' },
        { id: 'o2', status: OrderStatus.Paid, gift_chosen_at: null },
        { id: 'o3', status: OrderStatus.VoucherIssued, gift_chosen_at: 't' },
      ]),
      ordersReadyToFulfil: jest.fn().mockResolvedValue(['o9']),
    };
    fulfillment = { start: jest.fn().mockResolvedValue(undefined) };
    sending = { sendIfDue: jest.fn().mockResolvedValue(undefined) };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    sut = new CampaignFundingService(
      repo as unknown as CampaignsRepository,
      fulfillment as unknown as FulfillmentOrchestratorService,
      sending as unknown as CampaignSendingService,
      audit as unknown as AuditService,
    );
  });

  const flush = () => new Promise((resolve) => setImmediate(resolve));

  it('funds the campaign, then fulfils the settled gifts and sends, after answering', async () => {
    await sut.applyPayment('ebcmp_1', 5_000_000, '777');
    expect(repo.fund).toHaveBeenCalledWith('c1', 'ebcmp_1', 5_000_000, '777');
    expect(fulfillment.start).not.toHaveBeenCalled(); // not before the webhook returns

    await flush();
    await flush();
    // Only the paid, chosen one — o2 waits for its recipient to pick.
    expect(fulfillment.start).toHaveBeenCalledTimes(1);
    expect(fulfillment.start).toHaveBeenCalledWith('o1');
    expect(sending.sendIfDue).toHaveBeenCalledWith('c1');
  });

  it('does nothing more for a redelivered payment', async () => {
    repo.fund.mockResolvedValue('already_funded');
    await sut.applyPayment('ebcmp_1', 5_000_000, '777');
    await flush();
    expect(fulfillment.start).not.toHaveBeenCalled();
  });

  it('flags — never applies — money for a checkout the company abandoned', async () => {
    repo.findByPaystackReference.mockResolvedValue(null);
    await sut.applyPayment('ebcmp_old', 5_000_000, '777');
    expect(repo.fund).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'campaign.payment_unmatched' }),
    );
  });

  it('flags an amount mismatch instead of throwing at Paystack', async () => {
    repo.fund.mockRejectedValue({ message: 'campaign_amount_mismatch' });
    await expect(
      sut.applyPayment('ebcmp_1', 1, '777'),
    ).resolves.toBeUndefined();
    const event = (
      audit.record.mock.calls[0] as [
        { eventType: string; resourceId: string; metadata: { reason: string } },
      ]
    )[0];
    expect(event.eventType).toBe('campaign.payment_unmatched');
    expect(event.resourceId).toBe('c1');
    expect(event.metadata.reason).toMatch(/amount_mismatch/);
  });

  it('a fulfilment failure on one gift does not stop the rest', async () => {
    repo.orders.mockResolvedValue([
      { id: 'o1', status: OrderStatus.Paid, gift_chosen_at: 't' },
      { id: 'o2', status: OrderStatus.Paid, gift_chosen_at: 't' },
    ]);
    fulfillment.start.mockRejectedValueOnce(new Error('boom'));
    await expect(sut.fulfilCampaign('c1')).resolves.toBe(1);
    expect(fulfillment.start).toHaveBeenCalledTimes(2);
  });

  it('the sweep starts settled gifts that never started', async () => {
    await expect(sut.sweep()).resolves.toBe(1);
    expect(fulfillment.start).toHaveBeenCalledWith('o9');
  });
});

describe('CampaignGiftsService', () => {
  let repo: Record<string, jest.Mock>;
  let funding: { fulfilOrder: jest.Mock };
  let sut: CampaignGiftsService;

  beforeEach(() => {
    repo = {
      chooseGift: jest.fn().mockResolvedValue(true),
      saveThanks: jest.fn().mockResolvedValue(true),
      revealInfo: jest.fn().mockResolvedValue({
        company_name: 'Acme',
        sender_display_name: null,
        title: 'Thanks',
      }),
      recipientByOrder: jest.fn().mockResolvedValue({ thanks_at: null }),
      options: jest.fn().mockResolvedValue([{ gift_template_id: 'g1' }]),
    };
    funding = { fulfilOrder: jest.fn().mockResolvedValue(true) };
    sut = new CampaignGiftsService(
      repo as unknown as CampaignsRepository,
      {
        findById: jest.fn().mockResolvedValue({
          id: 'g1',
          name: 'Lunch',
          description: null,
          image_url: null,
          delivery_type: 'digital_voucher',
        }),
      } as unknown as GiftsService,
      funding as unknown as CampaignFundingService,
      {
        record: jest.fn().mockResolvedValue(undefined),
      } as unknown as AuditService,
    );
  });

  it('records the choice and fulfils it straight away', async () => {
    await sut.choose({ id: 'o1', campaign_id: 'c1' }, 'g1');
    expect(repo.chooseGift).toHaveBeenCalledWith('o1', 'g1');
    expect(funding.fulfilOrder).toHaveBeenCalledWith('o1');
  });

  it('refuses a second choice', async () => {
    repo.chooseGift.mockResolvedValue(false);
    await expect(
      sut.choose({ id: 'o1', campaign_id: 'c1' }, 'g1'),
    ).rejects.toThrow(/already been chosen/);
    expect(funding.fulfilOrder).not.toHaveBeenCalled();
  });

  it('accepts one thank-you, and only for a company gift', async () => {
    await sut.thank({ id: 'o1', campaign_id: 'c1' }, 'Thank you!');
    repo.saveThanks.mockResolvedValue(false);
    await expect(
      sut.thank({ id: 'o1', campaign_id: 'c1' }, 'Again'),
    ).rejects.toThrow(/already said thank you/);
    await expect(
      sut.thank({ id: 'o1', campaign_id: null }, 'Hi'),
    ).rejects.toThrow(/from a company/);
  });

  it('lists choices only while the recipient still has to pick', async () => {
    const choosing = await sut.revealInfo({
      id: 'o1',
      campaign_id: 'c1',
      status: 'paid',
      gift_chosen_at: null,
    });
    expect(choosing?.choices).toEqual([
      {
        giftTemplateId: 'g1',
        name: 'Lunch',
        description: null,
        imageUrl: null,
        deliveryType: 'digital_voucher',
      },
    ]);
    const chosen = await sut.revealInfo({
      id: 'o1',
      campaign_id: 'c1',
      status: 'voucher_issued',
      gift_chosen_at: 't',
    });
    expect(chosen?.choices).toBeNull();
    expect(
      await sut.revealInfo({ id: 'o1', campaign_id: null, status: 'paid' }),
    ).toBeNull();
  });
});
