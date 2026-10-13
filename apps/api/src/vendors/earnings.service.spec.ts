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
