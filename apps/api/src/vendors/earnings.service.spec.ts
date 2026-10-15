import { ConflictException, NotFoundException } from '@nestjs/common';
import { EarningsService } from './earnings.service';
import { PayoutOrdersChangedError } from './payouts.repository';

describe('EarningsService.recordPayout', () => {
  const staff = {
    userId: 'staff-1',
    authId: 'a',
    role: 'ebun_ops',
    email: null,
    name: null,
  } as const;
  const meta = { ipAddress: null, userAgent: null };
  const dto = {
    orderIds: ['o-1', 'o-1', 'o-2'],
    paymentRef: 'GTB-778812',
  };

  let payouts: { recordPayout: jest.Mock };
  let vendors: { findById: jest.Mock };
  let audit: { record: jest.Mock };
  let sut: EarningsService;

  beforeEach(() => {
    payouts = {
      recordPayout: jest.fn().mockResolvedValue({
        id: 'p-1',
        net_payout: 1440000,
        orders_count: 2,
        paid_at: '2026-10-13T17:00:00.000Z',
        payment_method: 'bank_transfer',
        payment_ref: 'GTB-778812',
        notes: null,
      }),
    };
    vendors = { findById: jest.fn().mockResolvedValue({ id: 'v-1' }) };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    sut = new EarningsService(
      payouts as never,
      vendors as never,
      audit as never,
    );
  });

  it('records the listed collections once each, as a bank transfer by default', async () => {
    const result = await sut.recordPayout('v-1', dto, staff, meta);

    expect(payouts.recordPayout).toHaveBeenCalledWith({
      vendorId: 'v-1',
      orderIds: ['o-1', 'o-2'],
      paymentRef: 'GTB-778812',
      paymentMethod: 'bank_transfer',
      notes: null,
      recordedBy: 'staff-1',
    });
    expect(result).toMatchObject({ amount: 1440000, collections: 2 });
  });

  it('audits the amount and reference, and nothing about the bank account', async () => {
    await sut.recordPayout('v-1', dto, staff, meta);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'vendor.payout_recorded',
        actorId: 'staff-1',
        metadata: expect.objectContaining({
          amount: 1440000,
          paymentRef: 'GTB-778812',
        }) as unknown,
      }),
    );
    expect(JSON.stringify(audit.record.mock.calls)).not.toMatch(
      /account|bank_name/i,
    );
  });

  it('409s when a listed collection was already paid or is not this vendor’s', async () => {
    payouts.recordPayout.mockRejectedValue(new PayoutOrdersChangedError());

    await expect(sut.recordPayout('v-1', dto, staff, meta)).rejects.toThrow(
      ConflictException,
    );
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('404s an unknown vendor without touching payouts', async () => {
    vendors.findById.mockResolvedValue(null);

    await expect(sut.recordPayout('v-x', dto, staff, meta)).rejects.toThrow(
      NotFoundException,
    );
    expect(payouts.recordPayout).not.toHaveBeenCalled();
  });
});

describe('EarningsService with automatic payouts in flight', () => {
  it('shows money on its way, and keeps it off the manual payment form', async () => {
    const row = (
      id: string,
      over: Record<string, unknown> = {},
    ): Record<string, unknown> => ({
      id,
      order_number: id,
      vendor_payout_amount: 900000,
      vendor_paid_at: null,
      vendor_payout_id: null,
      vendor_transfer_id: null,
      updated_at: '2026-10-15T10:00:00.000Z',
      gift_templates: { name: 'Cake' },
      redemptions: { completed_at: '2026-10-15T10:00:00.000Z' },
      ...over,
    });
    const payouts = {
      listCollections: jest
        .fn()
        .mockResolvedValue([
          row('o-1', { vendor_transfer_id: 'tr-1' }),
          row('o-2'),
        ]),
      listPayouts: jest.fn().mockResolvedValue([]),
    };
    const sut = new EarningsService(
      payouts as never,
      { findById: jest.fn().mockResolvedValue({ id: 'v-1' }) } as never,
      { record: jest.fn() } as never,
    );

    const ops = await sut.forOps('v-1');
    expect(ops.owedNow).toBe(1800000);
    expect(ops.onItsWay).toBe(900000);
    expect(ops.unpaidOrderIds).toEqual(['o-2']);

    const vendor = await sut.forVendor('v-1');
    expect(vendor).toMatchObject({ owedNow: 1800000, onItsWay: 900000 });
    expect('unpaidOrderIds' in vendor).toBe(false);
  });
});
