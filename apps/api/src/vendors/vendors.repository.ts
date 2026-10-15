import { randomUUID } from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/supabase.module';
import { OrderStatus } from '@ebun/types';
import type { GiftCategory } from '@ebun/types';

export interface VendorRow {
  id: string;
  business_name: string;
  owner_name: string;
  whatsapp_number: string;
  email: string | null;
  backup_phone?: string | null;
  category: GiftCategory;
  subcategories: string[] | null;
  service_areas: string[] | null;
  delivery_zones: string[] | null;
  commission_rate: number;
  bank_name: string | null;
  account_number: string | null;
  account_name: string | null;
  /** Paystack bank code; set by picking the bank from the list. */
  bank_code?: string | null;
  /** Paystack transfer recipient for automatic payouts; cleared when bank details change. */
  paystack_recipient_code?: string | null;
  active: boolean;
  verified: boolean;
  rating: number | null;
  total_orders: number;
  response_timeout_minutes: number;
  backup_vendor_id: string | null;
  notes: string | null;
  pickup_address: string | null;
  pickup_hours: string | null;
  portal_token: string;
  portal_token_rotated_at: string | null;
  created_at: string;
  updated_at: string;
}

/** The list view never selects bank details — they only travel on the single-vendor read. */
export type VendorSummaryRow = Pick<
  VendorRow,
  | 'id'
  | 'business_name'
  | 'owner_name'
  | 'whatsapp_number'
  | 'category'
  | 'service_areas'
  | 'delivery_zones'
  | 'active'
  | 'verified'
  | 'total_orders'
  | 'commission_rate'
  | 'created_at'
>;

/** Everything the counter screen is allowed to know about its own vendor. */
export interface VendorPortalRow {
  id: string;
  business_name: string;
  category: VendorRow['category'];
  active: boolean;
}

export interface OfferingRow {
  vendor_id: string;
  gift_template_id: string;
  vendor_price: number; // kobo
  available_zones: string[] | null;
  available: boolean;
  approved: boolean;
  /** In-store price (kobo) the vendor has asked to change to; null = no request. */
  proposed_price: number | null;
  price_proposed_at: string | null;
  gift_templates: {
    name: string;
    base_price: number;
    available: boolean;
    image_url: string | null;
  } | null;
}

/**
 * An offering as the vendor themselves sees it on their counter link:
 * the gift, whether ops has approved it, whether it is on sale in the
 * catalogue, and whether they have it today.
 */
export interface PortalOfferingRow {
  gift_template_id: string;
  vendor_price: number; // kobo
  available: boolean;
  approved: boolean;
  proposed_price: number | null;
  price_proposed_at: string | null;
  gift_templates: {
    name: string;
    base_price: number;
    image_url: string | null;
    available: boolean;
  } | null;
}

/** One vendor that will accept a given gift's code, as a recipient sees it. */
export interface CollectionPointRow {
  vendors: {
    id: string;
    business_name: string;
    whatsapp_number: string;
    pickup_address: string | null;
    pickup_hours: string | null;
    active: boolean;
  } | null;
}

const SUMMARY_COLUMNS =
  'id, business_name, owner_name, whatsapp_number, category, service_areas, delivery_zones, active, verified, total_orders, commission_rate, created_at';

const OFFERING_COLUMNS =
  'vendor_id, gift_template_id, vendor_price, available_zones, available, approved, proposed_price, price_proposed_at, gift_templates(name, base_price, available, image_url)';

const PORTAL_OFFERING_COLUMNS =
  'gift_template_id, vendor_price, available, approved, proposed_price, price_proposed_at, gift_templates(name, base_price, image_url, available)';

/**
 * Paid for and not yet handed over — a gift that still needs a vendor to
 * accept its code or deliver it. Unpaid checkouts (draft,
 * pending_payment) are left out: an abandoned checkout would otherwise
 * block a removal forever. Finished and failed orders are history.
 */
const STILL_TO_HAND_OVER: OrderStatus[] = [
  OrderStatus.Paid,
  OrderStatus.Processing,
  OrderStatus.VendorNotified,
  OrderStatus.VendorAccepted,
  OrderStatus.VendorDeclined,
  OrderStatus.VendorTimeout,
  OrderStatus.FulfillmentInProgress,
  OrderStatus.Dispatched,
  OrderStatus.VoucherIssued,
  OrderStatus.ReadyForRedemption,
  OrderStatus.RevealOpened,
];

/** Why approve_offering_price_change() refused, in the API's terms. */
export type PriceChangeRefusal =
  'not_found' | 'stale' | 'shared_gift' | 'invalid_share';

export class PriceChangeRefusedError extends Error {
  constructor(public readonly reason: PriceChangeRefusal) {
    super(`Price change refused: ${reason}`);
    this.name = 'PriceChangeRefusedError';
  }
}

export interface PriceChangeResult {
  old_base_price: number;
  new_base_price: number;
  old_vendor_price: number;
  new_vendor_price: number;
}

@Injectable()
export class VendorsRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async list(): Promise<VendorSummaryRow[]> {
    const response = (await this.supabase
      .from('vendors')
      .select(SUMMARY_COLUMNS)
      .order('created_at', { ascending: false })) as {
      data: VendorSummaryRow[] | null;
      error: PostgrestError | null;
    };
    if (response.error) throw response.error;
    return response.data ?? [];
  }

  /** vendor_id -> number of offerings, for the list view. Two cheap queries beat a join this small. */
  async countOfferingsByVendor(): Promise<Record<string, number>> {
    const response = (await this.supabase
      .from('vendor_gift_offerings')
      .select('vendor_id')) as {
      data: { vendor_id: string }[] | null;
      error: PostgrestError | null;
    };
    if (response.error) throw response.error;

    const counts: Record<string, number> = {};
    for (const row of response.data ?? []) {
      counts[row.vendor_id] = (counts[row.vendor_id] ?? 0) + 1;
    }
    return counts;
  }

  /** vendor_id -> items the vendor asked to sell that ops hasn't approved yet. */
  async countAwaitingApprovalByVendor(): Promise<Record<string, number>> {
    const response = (await this.supabase
      .from('vendor_gift_offerings')
      .select('vendor_id')
      .eq('approved', false)) as {
      data: { vendor_id: string }[] | null;
      error: PostgrestError | null;
    };
    if (response.error) throw response.error;

    const counts: Record<string, number> = {};
    for (const row of response.data ?? []) {
      counts[row.vendor_id] = (counts[row.vendor_id] ?? 0) + 1;
    }
    return counts;
  }

  async findById(id: string): Promise<VendorRow | null> {
    const response = (await this.supabase
      .from('vendors')
      .select('*')
      .eq('id', id)
      .maybeSingle()) as {
      data: VendorRow | null;
      error: PostgrestError | null;
    };
    if (response.error) throw response.error;
    return response.data ?? null;
  }

  async create(values: Record<string, unknown>): Promise<VendorRow> {
    const response = (await this.supabase
      .from('vendors')
      .insert(values)
      .select('*')
      .single()) as {
      data: VendorRow | null;
      error: PostgrestError | null;
    };
    if (response.error) throw response.error;
    if (!response.data) {
      throw new Error('vendors insert returned no row');
    }
    return response.data;
  }

  /** Null if the row vanished between the caller's read and this write. */
  async update(
    id: string,
    values: Record<string, unknown>,
  ): Promise<VendorRow | null> {
    const response = (await this.supabase
      .from('vendors')
      .update({ ...values, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .maybeSingle()) as {
      data: VendorRow | null;
      error: PostgrestError | null;
    };
    if (response.error) throw response.error;
    return response.data ?? null;
  }

  async listOfferings(vendorId: string): Promise<OfferingRow[]> {
    const response = (await this.supabase
      .from('vendor_gift_offerings')
      .select(OFFERING_COLUMNS)
      .eq('vendor_id', vendorId)) as {
      data: OfferingRow[] | null;
      error: PostgrestError | null;
    };
    if (response.error) throw response.error;
    return response.data ?? [];
  }

  async upsertOffering(values: {
    vendor_id: string;
    gift_template_id: string;
    vendor_price: number;
    available_zones: string[] | null;
    available: boolean;
    approved: boolean;
  }): Promise<OfferingRow> {
    const response = (await this.supabase
      .from('vendor_gift_offerings')
      .upsert(values, { onConflict: 'vendor_id,gift_template_id' })
      .select(OFFERING_COLUMNS)
      .single()) as {
      data: OfferingRow | null;
      error: PostgrestError | null;
    };
    if (response.error) throw response.error;
    if (!response.data) {
      throw new Error('vendor_gift_offerings upsert returned no row');
    }
    return response.data;
  }

  /** True if a row was actually deleted. */
  async deleteOffering(
    vendorId: string,
    giftTemplateId: string,
  ): Promise<boolean> {
    const response = (await this.supabase
      .from('vendor_gift_offerings')
      .delete()
      .eq('vendor_id', vendorId)
      .eq('gift_template_id', giftTemplateId)
      .select('gift_template_id')) as {
      data: { gift_template_id: string }[] | null;
      error: PostgrestError | null;
    };
    if (response.error) throw response.error;
    return (response.data ?? []).length > 0;
  }

  /**
   * Identifies a vendor from their portal token.
   *
   * Selects only what the counter screen needs. Bank details are
   * deliberately absent: the vendor's own payout information is not
   * something a counter device needs in order to hand over a pizza, and
   * the whole point of a narrow token is that losing the phone does not
   * lose anything else.
   */
  async findByPortalToken(token: string): Promise<VendorPortalRow | null> {
    const response = (await this.supabase
      .from('vendors')
      .select('id, business_name, category, active')
      .eq('portal_token', token)
      .maybeSingle()) as {
      data: VendorPortalRow | null;
      error: PostgrestError | null;
    };

    if (response.error) {
      throw response.error;
    }
    return response.data;
  }

  /**
   * Does this vendor actually sell this gift?
   *
   * The control that stops a vendor confirming a collection for
   * something they have never sold — which, before the portal existed,
   * ops could do by accident simply by picking the wrong name from a
   * dropdown, quietly crediting the payout to the wrong business.
   */
  async findOffering(
    vendorId: string,
    giftTemplateId: string,
  ): Promise<OfferingRow | null> {
    const response = (await this.supabase
      .from('vendor_gift_offerings')
      .select(OFFERING_COLUMNS)
      .eq('vendor_id', vendorId)
      .eq('gift_template_id', giftTemplateId)
      .maybeSingle()) as {
      data: OfferingRow | null;
      error: PostgrestError | null;
    };

    if (response.error) {
      throw response.error;
    }
    return response.data;
  }

  /**
   * Revokes a lost device by making its link identify nobody.
   *
   * The new token is generated here rather than by a Postgres default,
   * because supabase-js sends values, not SQL expressions — and doing
   * it in Node means the caller can hand the vendor their new link
   * immediately instead of reading it back.
   */
  async rotatePortalToken(vendorId: string): Promise<string | null> {
    const token = randomUUID();
    const response = (await this.supabase
      .from('vendors')
      .update({
        portal_token: token,
        portal_token_rotated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', vendorId)
      .select('id')
      .maybeSingle()) as {
      data: { id: string } | null;
      error: PostgrestError | null;
    };

    if (response.error) {
      throw response.error;
    }
    return response.data ? token : null;
  }

  /**
   * Every vendor holding an offering for this gift, with the fields a
   * recipient needs to find them. Filtering (active, has an address)
   * happens in VendorsService, where the rule is documented, rather
   * than as embedded-resource filters here — PostgREST's filter-on-embed
   * semantics are easy to get subtly wrong and this set is a handful of
   * rows.
   */
  async listCollectionPoints(
    giftTemplateId: string,
  ): Promise<CollectionPointRow[]> {
    const response = (await this.supabase
      .from('vendor_gift_offerings')
      .select(
        'vendors(id, business_name, whatsapp_number, pickup_address, pickup_hours, active)',
      )
      .eq('gift_template_id', giftTemplateId)) as {
      data: CollectionPointRow[] | null;
      error: PostgrestError | null;
    };
    if (response.error) throw response.error;
    return response.data ?? [];
  }

  async listPortalOfferings(vendorId: string): Promise<PortalOfferingRow[]> {
    const response = (await this.supabase
      .from('vendor_gift_offerings')
      .select(PORTAL_OFFERING_COLUMNS)
      .eq('vendor_id', vendorId)) as {
      data: PortalOfferingRow[] | null;
      error: PostgrestError | null;
    };
    if (response.error) throw response.error;
    return response.data ?? [];
  }

  /**
   * Flips only `available`. Scoped by vendor_id as well as the gift, so a
   * vendor's link can never touch another vendor's row. Null when this
   * vendor has no such offering.
   */
  async setOfferingAvailability(
    vendorId: string,
    giftTemplateId: string,
    available: boolean,
  ): Promise<PortalOfferingRow | null> {
    const response = (await this.supabase
      .from('vendor_gift_offerings')
      .update({ available })
      .eq('vendor_id', vendorId)
      .eq('gift_template_id', giftTemplateId)
      .select(PORTAL_OFFERING_COLUMNS)
      .maybeSingle()) as {
      data: PortalOfferingRow | null;
      error: PostgrestError | null;
    };
    if (response.error) throw response.error;
    return response.data ?? null;
  }

  /** Requests still waiting on ops, for the per-vendor cap. */
  async countAwaitingApproval(vendorId: string): Promise<number> {
    const response = (await this.supabase
      .from('vendor_gift_offerings')
      .select('gift_template_id', { count: 'exact', head: true })
      .eq('vendor_id', vendorId)
      .eq('approved', false)) as {
      count: number | null;
      error: PostgrestError | null;
    };
    if (response.error) throw response.error;
    return response.count ?? 0;
  }

  /** vendor_id -> price changes they've asked for, waiting on ops. */
  async countPriceRequestsByVendor(): Promise<Record<string, number>> {
    const response = (await this.supabase
      .from('vendor_gift_offerings')
      .select('vendor_id')
      .not('proposed_price', 'is', null)) as {
      data: { vendor_id: string }[] | null;
      error: PostgrestError | null;
    };
    if (response.error) throw response.error;

    const counts: Record<string, number> = {};
    for (const row of response.data ?? []) {
      counts[row.vendor_id] = (counts[row.vendor_id] ?? 0) + 1;
    }
    return counts;
  }

  /**
   * Of these gifts, the ones some OTHER vendor also sells. A gift has one
   * price for every seller, so only a gift's sole seller may ask to
   * change it.
   */
  async giftsSoldByOthers(
    vendorId: string,
    giftTemplateIds: string[],
  ): Promise<Set<string>> {
    if (giftTemplateIds.length === 0) return new Set();
    const response = (await this.supabase
      .from('vendor_gift_offerings')
      .select('gift_template_id')
      .in('gift_template_id', giftTemplateIds)
      .neq('vendor_id', vendorId)) as {
      data: { gift_template_id: string }[] | null;
      error: PostgrestError | null;
    };
    if (response.error) throw response.error;
    return new Set((response.data ?? []).map((row) => row.gift_template_id));
  }

  /**
   * Records (or, with null, withdraws) a vendor's price request. Scoped
   * by vendor_id so one vendor's link can never touch another's row.
   * Null when this vendor has no such offering.
   */
  async setProposedPrice(
    vendorId: string,
    giftTemplateId: string,
    proposedPrice: number | null,
  ): Promise<PortalOfferingRow | null> {
    const response = (await this.supabase
      .from('vendor_gift_offerings')
      .update({
        proposed_price: proposedPrice,
        price_proposed_at:
          proposedPrice === null ? null : new Date().toISOString(),
      })
      .eq('vendor_id', vendorId)
      .eq('gift_template_id', giftTemplateId)
      .select(PORTAL_OFFERING_COLUMNS)
      .maybeSingle()) as {
      data: PortalOfferingRow | null;
      error: PostgrestError | null;
    };
    if (response.error) throw response.error;
    return response.data ?? null;
  }

  /**
   * The gift's new price and the vendor's new share, in one transaction
   * — see approve_offering_price_change() in
   * 20261015090000_vendor_price_requests.sql. `expectedPrice` is the
   * request ops saw; if it has changed since, nothing is written.
   */
  async approvePriceChange(params: {
    vendorId: string;
    giftTemplateId: string;
    expectedPrice: number;
    vendorPrice: number;
  }): Promise<PriceChangeResult> {
    const response = (await this.supabase.rpc('approve_offering_price_change', {
      p_vendor_id: params.vendorId,
      p_gift_template_id: params.giftTemplateId,
      p_expected_price: params.expectedPrice,
      p_vendor_price: params.vendorPrice,
    })) as { data: PriceChangeResult[] | null; error: PostgrestError | null };

    if (response.error) {
      const message = response.error.message ?? '';
      for (const reason of [
        'not_found',
        'stale',
        'shared_gift',
        'invalid_share',
      ] as const) {
        if (message.includes(`price_change_${reason}`)) {
          throw new PriceChangeRefusedError(reason);
        }
      }
      throw response.error;
    }
    const row = response.data?.[0];
    if (!row) throw new Error('approve_offering_price_change returned no row');
    return {
      old_base_price: Number(row.old_base_price),
      new_base_price: Number(row.new_base_price),
      old_vendor_price: Number(row.old_vendor_price),
      new_vendor_price: Number(row.new_vendor_price),
    };
  }

  /**
   * Approves an offering the vendor asked for, leaving its price, zones
   * and "sold out" switch as they are. Null when there is no such
   * offering.
   */
  async approveOffering(
    vendorId: string,
    giftTemplateId: string,
  ): Promise<OfferingRow | null> {
    const response = (await this.supabase
      .from('vendor_gift_offerings')
      .update({ approved: true })
      .eq('vendor_id', vendorId)
      .eq('gift_template_id', giftTemplateId)
      .select(OFFERING_COLUMNS)
      .maybeSingle()) as {
      data: OfferingRow | null;
      error: PostgrestError | null;
    };
    if (response.error) throw response.error;
    return response.data ?? null;
  }

  /**
   * Paid gifts that would be stranded if this vendor stopped selling
   * this gift: their code would be refused at the counter (sellsGift
   * reads the offering) and the payout lookup would find nothing.
   *
   * When another vendor also sells the gift, a voucher can still be
   * collected there — so only orders tied to THIS vendor count: a
   * booked pickup here, or a delivery assigned here. When nobody else
   * sells it, every open order for the gift counts.
   */
  async ordersStillRelyingOn(
    vendorId: string,
    giftTemplateId: string,
  ): Promise<number> {
    const open = (await this.supabase
      .from('orders')
      .select('id, pickup_vendor_id')
      .eq('gift_template_id', giftTemplateId)
      .in('status', STILL_TO_HAND_OVER)
      .limit(1000)) as {
      data: { id: string; pickup_vendor_id: string | null }[] | null;
      error: PostgrestError | null;
    };
    if (open.error) throw open.error;
    const orders = open.data ?? [];
    if (orders.length === 0) return 0;

    const others = await this.giftsSoldByOthers(vendorId, [giftTemplateId]);
    if (others.size === 0) return orders.length;

    const assigned = (await this.supabase
      .from('gift_fulfillments')
      .select('order_id')
      .eq('vendor_id', vendorId)
      .in(
        'order_id',
        orders.map((order) => order.id),
      )) as {
      data: { order_id: string }[] | null;
      error: PostgrestError | null;
    };
    if (assigned.error) throw assigned.error;

    const tied = new Set((assigned.data ?? []).map((row) => row.order_id));
    for (const order of orders) {
      if (order.pickup_vendor_id === vendorId) tied.add(order.id);
    }
    return tied.size;
  }
}
