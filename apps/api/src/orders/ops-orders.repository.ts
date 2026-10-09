import { Inject, Injectable } from '@nestjs/common';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { OrderStatus } from '@ebun/types';
import { SUPABASE_CLIENT } from '../supabase/supabase.module';

/**
 * A nested select returns the embedded row as an object, or as an array
 * when PostgREST can't prove the relationship is to-one. Typed as both
 * so a schema change can't turn a compile error into a silent `[object
 * Object]` on an ops page.
 */
type Embedded<T> = T | T[] | null;

export interface OpsOrderListRow {
  id: string;
  order_number: string | null;
  status: OrderStatus;
  recipient_name: string;
  recipient_phone: string;
  total_amount: number;
  created_at: string;
  updated_at: string;
  expires_at: string;
  scheduled_send_at: string | null;
  gift_template: Embedded<{ name: string }>;
  vendor: Embedded<{ business_name: string }>;
}

export interface OpsOrderDetailRow extends OpsOrderListRow {
  gift_value: number;
  delivery_fee: number;
  service_fee: number;
  vendor_payout_amount: number | null;
  vendor_paid_at: string | null;
  paystack_reference: string | null;
  payment_verified_at: string | null;
  message_type: 'text' | 'voice' | 'video' | null;
  reveal_theme: string;
  reveal_opened_at: string | null;
  whatsapp_sent_at: string | null;
  delivery_address: string | null;
  delivery_zone: string | null;
  is_diaspora_sender: boolean;
  is_corporate_order: boolean;
  sender_country_code: string | null;
  notes: string | null;
}

export interface ListOrdersFilters {
  statuses?: OrderStatus[];
  /** Inclusive lower bound on created_at, ISO 8601. */
  from?: string;
  /** Exclusive upper bound on created_at, ISO 8601. */
  to?: string;
  /** Matched against order_number, recipient_name and recipient_phone. */
  search?: string;
  /** Only orders the stuck-order sweep would flag. */
  stuckOnly?: boolean;
  limit: number;
  offset: number;
}

/**
 * Columns the list query selects. Deliberately narrow, and deliberately
 * excludes three things ops does not need in order to do its job:
 *
 *   sender_message / message_url — the whole point of Ebun is that the
 *     sender records something personal for one named person. Staff
 *     being able to read or play it back by default is a privacy
 *     decision nobody made; the detail view reports that a message
 *     EXISTS and what kind, not what it says.
 *   sender_ip, reveal_opened_ip — retained for fraud investigation,
 *     which is a deliberate act against the database, not a column on
 *     a list page.
 *   reveal_token — possessing it opens the recipient's gift page.
 */
const LIST_COLUMNS =
  'id, order_number, status, recipient_name, recipient_phone, total_amount, created_at, updated_at, expires_at, scheduled_send_at, ' +
  // Column-name hints (`!gift_template_id`) rather than bare table
  // names: orders has TWO foreign keys into gift_templates
  // (gift_template_id and swapped_to_template_id), so an unhinted
  // embed is ambiguous and PostgREST rejects it outright.
  'gift_template:gift_templates!gift_template_id(name), ' +
  'vendor:vendors!vendor_id(business_name)';

const DETAIL_COLUMNS =
  LIST_COLUMNS +
  ', gift_value, delivery_fee, service_fee, vendor_payout_amount, vendor_paid_at, ' +
  'paystack_reference, payment_verified_at, message_type, reveal_theme, reveal_opened_at, ' +
  'whatsapp_sent_at, delivery_address, delivery_zone, is_diaspora_sender, is_corporate_order, ' +
  'sender_country_code, notes';

/**
 * The two states the stuck-order sweep watches. Imported conceptually
 * from jobs.config's STUCK_FULFILLMENT_MINUTES rather than duplicated —
 * see OpsOrdersService, which passes the cutoff in.
 */
export const STUCK_STATUSES: readonly OrderStatus[] = [
  OrderStatus.Processing,
  OrderStatus.FulfillmentInProgress,
];

/**
 * PostgREST's `or=` parameter is a comma-and-parenthesis separated
 * expression language, and supabase-js passes the string through
 * verbatim. A raw search term containing `,` `)` or `.` therefore
 * doesn't escape SQL — PostgREST parameterises the values — but it DOES
 * let a caller rewrite the filter expression itself and read rows the
 * query was never meant to return. Allow-list rather than deny-list:
 * order numbers are `EBN-XXXX`, phones are `+234…`, names are words.
 * Nothing legitimate needs anything else.
 */
export function sanitiseSearchTerm(raw: string): string {
  return raw.replace(/[^A-Za-z0-9 +\-_@]/g, '').trim();
}

/**
 * Read-only ops access to orders.
 *
 * A separate class from OrdersRepository on purpose. That one is
 * deliberately NOT exported from OrdersModule so nothing can reach the
 * atomic compare-and-swap without going through the state machine
 * first; bolting ops list queries onto it would mean exporting it, and
 * the guarantee would go with it. This class has no write method at
 * all, so exporting it costs nothing.
 */
@Injectable()
export class OpsOrdersRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async list(
    filters: ListOrdersFilters,
    stuckCutoff: Date,
  ): Promise<{ rows: OpsOrderListRow[]; total: number }> {
    let query = this.supabase
      .from('orders')
      // `count: 'exact'` so the UI can say "showing 1–50 of 312"
      // rather than guessing from a full page. Exact rather than
      // estimated: at Ebun's order volume the planner's estimate is
      // wrong often enough to look broken, and the cost is trivial.
      .select(LIST_COLUMNS, { count: 'exact' });

    if (filters.statuses?.length) {
      query = query.in('status', filters.statuses);
    }
    if (filters.from) {
      query = query.gte('created_at', filters.from);
    }
    if (filters.to) {
      query = query.lt('created_at', filters.to);
    }
    if (filters.stuckOnly) {
      query = query
        .in('status', STUCK_STATUSES as OrderStatus[])
        .lt('updated_at', stuckCutoff.toISOString());
    }

    const term = filters.search ? sanitiseSearchTerm(filters.search) : '';
    if (term) {
      query = query.or(
        `order_number.ilike.*${term}*,recipient_name.ilike.*${term}*,recipient_phone.ilike.*${term}*`,
      );
    }

    const response = (await query
      // Newest first: the order someone is asking about on the phone is
      // almost always the most recent one.
      .order('created_at', { ascending: false })
      .range(filters.offset, filters.offset + filters.limit - 1)) as {
      data: OpsOrderListRow[] | null;
      error: PostgrestError | null;
      count: number | null;
    };

    if (response.error) {
      throw response.error;
    }

    return { rows: response.data ?? [], total: response.count ?? 0 };
  }

  async findById(id: string): Promise<OpsOrderDetailRow | null> {
    const response = (await this.supabase
      .from('orders')
      .select(DETAIL_COLUMNS)
      .eq('id', id)
      .maybeSingle()) as {
      data: OpsOrderDetailRow | null;
      error: PostgrestError | null;
    };

    if (response.error) {
      throw response.error;
    }
    return response.data ?? null;
  }

  /**
   * How many orders the stuck sweep would flag right now. Returned on
   * every list response so the banner is correct even when the list is
   * filtered to something else — a stuck paid order is money taken for
   * a gift that was never delivered, and it should not be possible to
   * filter it out of sight by accident.
   */
  async countStuck(stuckCutoff: Date): Promise<number> {
    const response = (await this.supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .in('status', STUCK_STATUSES as OrderStatus[])
      .lt('updated_at', stuckCutoff.toISOString())) as {
      error: PostgrestError | null;
      count: number | null;
    };

    if (response.error) {
      throw response.error;
    }
    return response.count ?? 0;
  }
}
