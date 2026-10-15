import { Inject, Injectable } from '@nestjs/common';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { OrderStatus } from '@ebun/types';
import { SUPABASE_CLIENT } from '../supabase/supabase.module';

type Result<T> = { data: T | null; error: PostgrestError | null };

export interface UnconfirmedPickupRow {
  id: string;
  order_number: string | null;
  recipient_name: string;
  pickup_at: string;
  pickup_booked_at: string;
  gift_templates: { name: string } | null;
  vendors: {
    id: string;
    business_name: string;
    whatsapp_number: string;
    backup_phone: string | null;
  } | null;
}

export interface VendorReadinessRow {
  id: string;
  business_name: string;
  active: boolean;
  pickup_address: string | null;
  // Read only to test presence; never leaves the repository.
  account_number: string | null;
}

export interface OwedRow {
  vendor_id: string;
  vendor_payout_amount: number;
  updated_at: string;
}

export interface PayoutVendorRow {
  id: string;
  business_name: string;
  bank_name: string | null;
  account_name: string | null;
  account_number: string | null;
}

export interface RecentOrderRow {
  id: string;
  order_number: string | null;
  status: OrderStatus;
  recipient_name: string;
  total_amount: number;
  created_at: string;
  gift_templates: { name: string } | null;
}

/** Statuses that mean money was actually taken. */
const PAID_STATUSES_EXCLUDED = [
  OrderStatus.Draft,
  OrderStatus.PendingPayment,
  OrderStatus.PaymentFailed,
  OrderStatus.Cancelled,
];

/**
 * The read-only queries behind /ops's Today page and sidebar counts.
 * Everything here is a count or a short list — the page loads on every
 * ops navigation, so nothing pages through a whole table.
 */
@Injectable()
export class OverviewRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async paidSince(since: Date): Promise<{ count: number; total: number }> {
    const response = (await this.supabase
      .from('orders')
      .select('total_amount')
      .gte('payment_verified_at', since.toISOString())
      .not('status', 'in', `(${PAID_STATUSES_EXCLUDED.join(',')})`)
      .limit(5000)) as Result<{ total_amount: number }[]>;
    if (response.error) throw response.error;
    const rows = response.data ?? [];
    return {
      count: rows.length,
      total: rows.reduce((sum, row) => sum + (row.total_amount ?? 0), 0),
    };
  }

  /** Gifts that reached their person since `since`: collected at a counter or delivered to a door. */
  async handedOverSince(since: Date): Promise<number> {
    const [collected, delivered] = await Promise.all([
      this.supabase
        .from('redemptions')
        .select('id', { count: 'exact', head: true })
        .gte('completed_at', since.toISOString()),
      this.supabase
        .from('gift_fulfillments')
        .select('id', { count: 'exact', head: true })
        .gte('delivered_at', since.toISOString()),
    ]);
    if (collected.error) throw collected.error;
    if (delivered.error) throw delivered.error;
    return (collected.count ?? 0) + (delivered.count ?? 0);
  }

  async unconfirmedPickups(
    bookedBefore: Date,
    pickupAfter: Date,
  ): Promise<UnconfirmedPickupRow[]> {
    const response = (await this.supabase
      .from('orders')
      .select(
        'id, order_number, recipient_name, pickup_at, pickup_booked_at, gift_templates!gift_template_id(name), vendors!pickup_vendor_id(id, business_name, whatsapp_number, backup_phone)',
      )
      .eq('status', OrderStatus.RevealOpened)
      .not('pickup_vendor_id', 'is', null)
      .is('pickup_confirmed_at', null)
      .lt('pickup_booked_at', bookedBefore.toISOString())
      .gt('pickup_at', pickupAfter.toISOString())
      .order('pickup_at', { ascending: true })
      .limit(50)) as Result<UnconfirmedPickupRow[]>;
    if (response.error) throw response.error;
    return response.data ?? [];
  }

  /** vendor id -> number of items they've asked to sell that are waiting on ops. */
  async awaitingApprovalByVendor(): Promise<
    { vendorId: string; name: string; count: number }[]
  > {
    const response = (await this.supabase
      .from('vendor_gift_offerings')
      .select('vendor_id, vendors(business_name)')
      .eq('approved', false)
      .limit(1000)) as Result<
      { vendor_id: string; vendors: { business_name: string } | null }[]
    >;
    if (response.error) throw response.error;
    const byVendor = new Map<string, { name: string; count: number }>();
    for (const row of response.data ?? []) {
      const entry = byVendor.get(row.vendor_id) ?? {
        name: row.vendors?.business_name ?? 'A vendor',
        count: 0,
      };
      entry.count += 1;
      byVendor.set(row.vendor_id, entry);
    }
    return [...byVendor].map(([vendorId, v]) => ({ vendorId, ...v }));
  }

  /** vendor id -> new prices they've asked for that are waiting on ops. */
  async priceRequestsByVendor(): Promise<
    { vendorId: string; name: string; count: number }[]
  > {
    const response = (await this.supabase
      .from('vendor_gift_offerings')
      .select('vendor_id, vendors(business_name)')
      .not('proposed_price', 'is', null)
      .limit(1000)) as Result<
      { vendor_id: string; vendors: { business_name: string } | null }[]
    >;
    if (response.error) throw response.error;
    const byVendor = new Map<string, { name: string; count: number }>();
    for (const row of response.data ?? []) {
      const entry = byVendor.get(row.vendor_id) ?? {
        name: row.vendors?.business_name ?? 'A vendor',
        count: 0,
      };
      entry.count += 1;
      byVendor.set(row.vendor_id, entry);
    }
    return [...byVendor].map(([vendorId, v]) => ({ vendorId, ...v }));
  }

  async vendorReadiness(): Promise<VendorReadinessRow[]> {
    const response = (await this.supabase
      .from('vendors')
      .select('id, business_name, active, pickup_address, account_number')
      .eq('active', true)
      .limit(1000)) as Result<VendorReadinessRow[]>;
    if (response.error) throw response.error;
    return response.data ?? [];
  }

  async owed(): Promise<OwedRow[]> {
    const response = (await this.supabase
      .from('orders')
      .select('vendor_id, vendor_payout_amount, updated_at')
      .not('vendor_payout_amount', 'is', null)
      .not('vendor_id', 'is', null)
      .is('vendor_paid_at', null)
      .limit(5000)) as Result<OwedRow[]>;
    if (response.error) throw response.error;
    return response.data ?? [];
  }

  async payoutVendors(ids: string[]): Promise<PayoutVendorRow[]> {
    if (ids.length === 0) return [];
    const response = (await this.supabase
      .from('vendors')
      .select('id, business_name, bank_name, account_name, account_number')
      .in('id', ids)) as Result<PayoutVendorRow[]>;
    if (response.error) throw response.error;
    return response.data ?? [];
  }

  async recentOrders(limit: number): Promise<RecentOrderRow[]> {
    const response = (await this.supabase
      .from('orders')
      .select(
        'id, order_number, status, recipient_name, total_amount, created_at, gift_templates!gift_template_id(name)',
      )
      .not(
        'status',
        'in',
        `(${[OrderStatus.Draft, OrderStatus.PendingPayment].join(',')})`,
      )
      .order('created_at', { ascending: false })
      .limit(limit)) as Result<RecentOrderRow[]>;
    if (response.error) throw response.error;
    return response.data ?? [];
  }
}
