import { Injectable } from '@nestjs/common';
import { DeliveriesService } from '../deliveries/deliveries.service';
import { DELIVERY_STAGE_TITLE } from './overview.copy';
import { OrdersService } from '../orders/orders.service';
import { STUCK_FULFILLMENT_MINUTES } from '../jobs/jobs.config';
import { OverviewRepository } from './overview.repository';
import { AutoPayoutsRepository } from '../payouts/auto-payouts.repository';

/** Something on /ops that needs a person, most urgent first. */
export interface AttentionItem {
  kind:
    | 'stuck_order'
    | 'delivery'
    | 'pickup'
    | 'approval'
    | 'partner_details'
    | 'refund'
    | 'payout';
  /** 1 = money taken and nothing happening; 3 = tidy-up. */
  urgency: 1 | 2 | 3;
  title: string;
  detail: string | null;
  href: string;
  since: string | null;
}

export interface OpsOverview {
  today: {
    /** Orders paid since midnight Lagos time. */
    orders: number;
    /** kobo, what senders paid today. */
    takings: number;
    /** Collected at a counter or delivered to a door today. */
    handedOver: number;
  };
  /** kobo owed to partners right now, and how many partners. */
  owed: { total: number; partners: number };
  /** Sidebar badges. */
  counts: {
    attention: number;
    deliveries: number;
    approvals: number;
    payouts: number;
  };
  attention: AttentionItem[];
  recentOrders: {
    id: string;
    orderNumber: string | null;
    status: string;
    recipientName: string;
    giftName: string;
    totalAmount: number;
    createdAt: string;
  }[];
}

export interface PayoutRowView {
  vendorId: string;
  name: string;
  owed: number;
  collections: number;
  /** The oldest unpaid handover — how long they've been waiting. */
  oldestAt: string;
  bank: {
    bankName: string | null;
    accountName: string | null;
    last4: string;
  } | null;
}

const PICKUP_ACK_MINUTES = 30;

/**
 * One read that answers "what needs me?" for /ops: today's numbers, what
 * partners are owed, and the short list of things a person must act on.
 * Each source is independent; one failing loses its part of the page,
 * never the page (see settle()).
 */
@Injectable()
export class OverviewService {
  constructor(
    private readonly repository: OverviewRepository,
    private readonly deliveries: DeliveriesService,
    private readonly orders: OrdersService,
    private readonly transfers: AutoPayoutsRepository,
  ) {}

  async overview(): Promise<OpsOverview> {
    const since = lagosMidnight();
    const now = Date.now();
    const [
      paid,
      handedOver,
      owed,
      stuck,
      deliveries,
      pickups,
      approvals,
      priceRequests,
      stuckRefunds,
      failedPayouts,
      readiness,
      recent,
    ] = await Promise.all([
      settle(this.repository.paidSince(since), { count: 0, total: 0 }),
      settle(this.repository.handedOverSince(since), 0),
      settle(this.repository.owed(), []),
      settle(
        this.orders.findStuckInFulfillment(
          new Date(now - STUCK_FULFILLMENT_MINUTES * 60_000),
          20,
        ),
        [],
      ),
      settle(this.deliveries.listForOps(), []),
      settle(
        this.repository.unconfirmedPickups(
          new Date(now - PICKUP_ACK_MINUTES * 60_000),
          new Date(now - 60 * 60_000),
        ),
        [],
      ),
      settle(this.repository.awaitingApprovalByVendor(), []),
      settle(this.repository.priceRequestsByVendor(), []),
      settle(this.repository.refundsNeedingAttention(), []),
      settle(
        this.transfers.recentFailures(new Date(now - 7 * 24 * 60 * 60_000)),
        [],
      ),
      settle(this.repository.vendorReadiness(), []),
      settle(this.repository.recentOrders(8), []),
    ]);

    const attention: AttentionItem[] = [];

    // A refund Paystack couldn't finish: the order says refunded, the
    // sender hasn't got their money. Top of the list.
    for (const refund of stuckRefunds) {
      attention.push({
        kind: 'refund',
        urgency: 1,
        title: `Refund for ${refund.orders?.order_number ?? 'an order'} didn't go through`,
        detail: refund.failure_reason,
        href: `/ops/orders/${refund.order_id}`,
        since: refund.failed_at ?? refund.created_at,
      });
    }

    // An automatic payout that didn't go through: a partner is waiting
    // for money they were promised within minutes.
    for (const transfer of failedPayouts) {
      attention.push({
        kind: 'payout',
        urgency: 1,
        title: `Automatic payout to ${transfer.vendors?.business_name ?? 'a partner'} didn't go through`,
        detail: transfer.failure_reason,
        href: `/ops/vendors/${transfer.vendor_id}#earnings`,
        since: transfer.updated_at,
      });
    }

    for (const order of stuck) {
      attention.push({
        kind: 'stuck_order',
        urgency: 1,
        title: `${order.order_number ?? 'An order'} is stuck in fulfilment`,
        detail: 'Paid for, and not moving. Decide: retry or refund.',
        href: `/ops/orders/${order.id}`,
        since: (order.updated_at as string | undefined) ?? null,
      });
    }

    for (const d of deliveries) {
      if (!d.late) continue;
      attention.push({
        kind: 'delivery',
        urgency:
          d.stage === 'needs_vendor' || d.stage === 'unacknowledged' ? 1 : 2,
        title: `${d.giftName} for ${d.recipientName}: ${DELIVERY_STAGE_TITLE[d.stage]}`,
        detail:
          [d.vendorName, d.area, d.orderNumber].filter(Boolean).join(' · ') ||
          null,
        href: '/ops/deliveries',
        since: d.waitingSince,
      });
    }

    for (const p of pickups) {
      const vendor = p.vendors;
      attention.push({
        kind: 'pickup',
        urgency: 1,
        title: `${vendor?.business_name ?? 'A vendor'} hasn't confirmed ${firstName(p.recipient_name)}'s pickup`,
        detail: [
          `Coming ${lagosTime(p.pickup_at)}`,
          vendor ? `Call ${vendor.whatsapp_number}` : null,
          vendor?.backup_phone ? `or ${vendor.backup_phone}` : null,
        ]
          .filter(Boolean)
          .join(' · '),
        href: `/ops/orders/${p.id}`,
        since: p.pickup_booked_at,
      });
    }

    for (const a of approvals) {
      attention.push({
        kind: 'approval',
        urgency: 2,
        title: `${a.name} wants to sell ${a.count} new ${a.count === 1 ? 'item' : 'items'}`,
        detail: 'Check the price and photo, then approve.',
        href: `/ops/vendors/${a.vendorId}`,
        since: null,
      });
    }

    for (const p of priceRequests) {
      attention.push({
        kind: 'approval',
        // The old price keeps selling until someone decides, so this is
        // a vendor charging senders a price they no longer charge.
        urgency: 2,
        title: `${p.name} asked to change ${p.count === 1 ? 'a price' : `${p.count} prices`}`,
        detail: 'The old price keeps selling until you approve or decline.',
        href: `/ops/vendors/${p.vendorId}`,
        since: null,
      });
    }

    for (const v of readiness) {
      const missing = [
        v.pickup_address?.trim() ? null : 'shop address',
        v.account_number ? null : 'bank details',
      ].filter(Boolean);
      if (missing.length === 0) continue;
      attention.push({
        kind: 'partner_details',
        urgency: 3,
        title: `${v.business_name} has no ${missing.join(' or ')}`,
        detail: v.account_number
          ? 'Recipients can’t be sent to collect there.'
          : 'They can’t be paid until it’s added.',
        href: `/ops/vendors/${v.id}`,
        since: null,
      });
    }

    attention.sort((a, b) => a.urgency - b.urgency);

    const owedPartners = new Set(owed.map((row) => row.vendor_id));
    const deliveriesNeedingAction = deliveries.filter(
      (d) => d.stage === 'needs_vendor' || d.late,
    ).length;

    return {
      today: { orders: paid.count, takings: paid.total, handedOver },
      owed: {
        total: owed.reduce((sum, row) => sum + row.vendor_payout_amount, 0),
        partners: owedPartners.size,
      },
      counts: {
        attention: attention.filter((a) => a.urgency < 3).length,
        deliveries: deliveriesNeedingAction,
        // Partners with anything waiting on ops: a new item or a new price.
        approvals: new Set(
          [...approvals, ...priceRequests].map((a) => a.vendorId),
        ).size,
        payouts: owedPartners.size,
      },
      attention: attention.slice(0, 30),
      recentOrders: recent.map((o) => ({
        id: o.id,
        orderNumber: o.order_number,
        status: o.status,
        recipientName: o.recipient_name,
        giftName: o.gift_templates?.name ?? 'Gift',
        totalAmount: o.total_amount,
        createdAt: o.created_at,
      })),
    };
  }

  /** Every partner owed money, most owed first — the one place to see who needs paying. */
  async payouts(): Promise<PayoutRowView[]> {
    const owed = await this.repository.owed();
    const byVendor = new Map<
      string,
      { owed: number; count: number; oldest: string }
    >();
    for (const row of owed) {
      const entry = byVendor.get(row.vendor_id) ?? {
        owed: 0,
        count: 0,
        oldest: row.updated_at,
      };
      entry.owed += row.vendor_payout_amount;
      entry.count += 1;
      if (row.updated_at < entry.oldest) entry.oldest = row.updated_at;
      byVendor.set(row.vendor_id, entry);
    }
    const vendors = await this.repository.payoutVendors([...byVendor.keys()]);
    return vendors
      .map((v) => {
        const entry = byVendor.get(v.id)!;
        return {
          vendorId: v.id,
          name: v.business_name,
          owed: entry.owed,
          collections: entry.count,
          oldestAt: entry.oldest,
          bank: v.account_number
            ? {
                bankName: v.bank_name,
                accountName: v.account_name,
                last4: v.account_number.slice(-4),
              }
            : null,
        };
      })
      .sort((a, b) => b.owed - a.owed);
  }
}

async function settle<T>(work: Promise<T>, fallback: T): Promise<T> {
  try {
    return await work;
  } catch {
    return fallback;
  }
}

/** Midnight today in Lagos (UTC+1, no daylight saving). */
function lagosMidnight(): Date {
  const lagos = new Date(Date.now() + 60 * 60_000);
  return new Date(
    Date.UTC(lagos.getUTCFullYear(), lagos.getUTCMonth(), lagos.getUTCDate()) -
      60 * 60_000,
  );
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

function lagosTime(iso: string): string {
  return new Date(iso).toLocaleString('en-NG', {
    timeZone: 'Africa/Lagos',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}
