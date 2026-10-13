import { Test } from '@nestjs/testing';
import { DeliveriesService } from '../deliveries/deliveries.service';
import { OrdersService } from '../orders/orders.service';
import { OverviewRepository } from './overview.repository';
import { OverviewService } from './overview.service';

describe('OverviewService', () => {
  let sut: OverviewService;
  let repo: Record<string, jest.Mock>;
  let deliveries: { listForOps: jest.Mock };
  let orders: { findStuckInFulfillment: jest.Mock };

  beforeEach(async () => {
    repo = {
      paidSince: jest.fn().mockResolvedValue({ count: 3, total: 4_500_000 }),
      handedOverSince: jest.fn().mockResolvedValue(2),
      owed: jest.fn().mockResolvedValue([
        {
          vendor_id: 'v1',
          vendor_payout_amount: 720_000,
          updated_at: '2026-10-13T10:00:00Z',
        },
        {
          vendor_id: 'v1',
          vendor_payout_amount: 405_000,
          updated_at: '2026-10-12T10:00:00Z',
        },
        {
          vendor_id: 'v2',
          vendor_payout_amount: 2_150_000,
          updated_at: '2026-10-14T10:00:00Z',
        },
      ]),
      unconfirmedPickups: jest.fn().mockResolvedValue([]),
      awaitingApprovalByVendor: jest
        .fn()
        .mockResolvedValue([{ vendorId: 'v3', name: 'Cake Co', count: 2 }]),
      vendorReadiness: jest.fn().mockResolvedValue([
        {
          id: 'v1',
          business_name: 'Ready Ltd',
          active: true,
          pickup_address: 'x',
          account_number: '0123456789',
        },
        {
          id: 'v4',
          business_name: 'No Bank',
          active: true,
          pickup_address: 'x',
          account_number: null,
        },
      ]),
      recentOrders: jest.fn().mockResolvedValue([]),
      payoutVendors: jest.fn().mockResolvedValue([
        {
          id: 'v1',
          business_name: 'Ready Ltd',
          bank_name: 'GTBank',
          account_name: 'Ready',
          account_number: '0123456789',
        },
        {
          id: 'v2',
          business_name: 'Hamper House',
          bank_name: null,
          account_name: null,
          account_number: null,
        },
      ]),
    };
    deliveries = {
      listForOps: jest.fn().mockResolvedValue([
        {
          orderId: 'o9',
          giftName: 'Hamper',
          recipientName: 'Ada',
          stage: 'needs_vendor',
          late: true,
          waitingSince: 'x',
          vendorName: null,
          area: 'Lekki',
          orderNumber: 'EBN-9',
        },
        {
          orderId: 'o8',
          giftName: 'Cake',
          recipientName: 'Bo',
          stage: 'preparing',
          late: false,
          waitingSince: 'x',
          vendorName: 'V',
          area: null,
          orderNumber: 'EBN-8',
        },
      ]),
    };
    orders = {
      findStuckInFulfillment: jest
        .fn()
        .mockResolvedValue([
          { id: 'o1', order_number: 'EBN-1', updated_at: 'x' },
        ]),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        OverviewService,
        { provide: OverviewRepository, useValue: repo },
        { provide: DeliveriesService, useValue: deliveries },
        { provide: OrdersService, useValue: orders },
      ],
    }).compile();
    sut = moduleRef.get(OverviewService);
  });

  it('puts money-at-risk first and tidy-ups last, and skips deliveries that are on time', async () => {
    const result = await sut.overview();

    expect(result.attention.map((a) => a.kind)).toEqual([
      'stuck_order',
      'delivery',
      'approval',
      'partner_details',
    ]);
    expect(result.attention[3].title).toBe('No Bank has no bank details');
    // The sidebar badge counts what needs acting on, not the tidy-ups.
    expect(result.counts).toEqual({
      attention: 3,
      deliveries: 1,
      approvals: 1,
      payouts: 2,
    });
  });

  it("sums today's takings and what partners are owed", async () => {
    const result = await sut.overview();

    expect(result.today).toEqual({
      orders: 3,
      takings: 4_500_000,
      handedOver: 2,
    });
    expect(result.owed).toEqual({ total: 3_275_000, partners: 2 });
  });

  it('still renders when one source fails', async () => {
    repo.paidSince.mockRejectedValue(new Error('timeout'));

    const result = await sut.overview();

    expect(result.today.orders).toBe(0);
    expect(result.attention.length).toBeGreaterThan(0);
  });

  it('lists who is owed, most first, with only the last four digits of an account', async () => {
    const rows = await sut.payouts();

    expect(rows.map((r) => [r.name, r.owed, r.collections])).toEqual([
      ['Hamper House', 2_150_000, 1],
      ['Ready Ltd', 1_125_000, 2],
    ]);
    expect(rows[1].bank).toEqual({
      bankName: 'GTBank',
      accountName: 'Ready',
      last4: '6789',
    });
    expect(rows[1].oldestAt).toBe('2026-10-12T10:00:00Z');
    expect(JSON.stringify(rows)).not.toContain('0123456789');
  });
});
