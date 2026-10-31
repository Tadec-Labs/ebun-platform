import { Inject, Injectable } from '@nestjs/common';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { FulfillmentStatus, FulfillmentType, OrderStatus } from '@ebun/types';
import { SUPABASE_CLIENT } from '../supabase/supabase.module';
import { vendorPayoutForOrder } from '../pricing/vendor-payout';

/** The delivery half of a physical gift's gift_fulfillments row. */
export interface DeliveryFulfillmentRow {
  order_id: string;
  vendor_id: string | null;
  status: FulfillmentStatus;
  vendor_notified_at: string | null;
  vendor_accepted_at: string | null;
  rider_name: string | null;
  rider_phone: string | null;
  rider_dispatched_at: string | null;
  delivered_at: string | null;
  /** Wrong-or-right codes the vendor has tried; locked at 5. The code itself is never selected here. */
  handover_code_attempts: number;
  created_at: string;
}

/** What one vendor attempt at the recipient's handover code came to. See try_handover_code(). */
export type HandoverCodeResult = 'ok' | 'wrong' | 'locked' | 'not_found';

/** An order as delivery needs it: who, where, and for how much. */
export interface DeliveryOrderRow {
  id: string;
  status: OrderStatus;
  order_number: string | null;
  gift_template_id: string;
  /** kobo — what the sender paid for the gift itself; the vendor's share is of this. */
  gift_value: number;
  delivery_fee: number;
  recipient_name: string;
  recipient_phone: string;
  delivery_address: string | null;
  delivery_zone: string | null;
  delivery_phone: string | null;
  delivery_note: string | null;
  delivery_details_at: string | null;
  /** The partner couldn't hand it over at the door; it is collected at the shop instead. */
  delivery_failed_at: string | null;
  delivery_failed_reason: string | null;
  created_at: string;
  gift_templates: {
    name: string;
    delivery_type: FulfillmentType;
    delivery_window: string | null;
  } | null;
}

/** One open delivery, joined for the vendor's and ops' lists. */
export interface OpenDeliveryRow extends DeliveryFulfillmentRow {
  orders: DeliveryOrderRow | null;
  vendors: { business_name: string } | null;
}

/** A doorstep gift still waiting for its address, with what the sender nudge needs. */
export interface AwaitingAddressRow {
  id: string;
  /** As typed at checkout; null on older orders. */
  sender_name: string | null;
  recipient_name: string;
  recipient_phone: string;
  reveal_token: string;
  address_nudges: number;
  created_at: string;
  expires_at: string;
  gift_templates: { name: string } | null;
  users: { email: string | null; name: string | null } | null;
}

/** A vendor who could deliver a given gift. */
export interface DeliveryCandidateRow {
  vendor_price: number;
  available: boolean;
  approved: boolean;
  vendors: {
    id: string;
    business_name: string;
    active: boolean;
    delivery_zones: string[] | null;
    service_areas: string[] | null;
  } | null;
}

const FULFILLMENT_COLUMNS =
  'order_id, vendor_id, status, vendor_notified_at, vendor_accepted_at, rider_name, rider_phone, rider_dispatched_at, delivered_at, handover_code_attempts, created_at';

// orders links to gift_templates twice (swapped_to_template_id too), so
// the embed names its foreign key or PostgREST refuses it as ambiguous.
const ORDER_COLUMNS =
  'id, status, order_number, gift_template_id, gift_value, delivery_fee, recipient_name, recipient_phone, delivery_address, delivery_zone, delivery_phone, delivery_note, delivery_details_at, delivery_failed_at, delivery_failed_reason, created_at, gift_templates!gift_template_id(name, delivery_type, delivery_window)';

type Result<T> = { data: T | null; error: PostgrestError | null };

/**
 * Every query doorstep delivery makes. Talks to Supabase directly rather
 * than through VendorsRepository / OrdersRepository on purpose:
 * VendorsModule imports DeliveriesModule (the vendor's "To deliver"
 * list), so leaning on VendorsModule from here would be a circular
 * import, and OrdersRepository's reads are deliberately narrow per
 * caller.
 *
 * Writes that must not race are guarded in the WHERE clause (status,
 * vendor, not-yet-dispatched) and report whether a row matched, so the
 * service can turn "nothing changed" into a clear message instead of a
 * silent success.
 */
@Injectable()
export class DeliveriesRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async findOrder(orderId: string): Promise<DeliveryOrderRow | null> {
    const response = (await this.supabase
      .from('orders')
      .select(ORDER_COLUMNS)
      .eq('id', orderId)
      .maybeSingle()) as Result<DeliveryOrderRow>;
    if (response.error) throw response.error;
    return response.data ?? null;
  }

  async findFulfillment(
    orderId: string,
  ): Promise<DeliveryFulfillmentRow | null> {
    const response = (await this.supabase
      .from('gift_fulfillments')
      .select(FULFILLMENT_COLUMNS)
      .eq('order_id', orderId)
      .eq('fulfillment_type', FulfillmentType.Physical)
      .maybeSingle()) as Result<DeliveryFulfillmentRow>;
    if (response.error) throw response.error;
    return response.data ?? null;
  }

  /** Only while the gift is still being prepared — never after a rider has it. */
  async saveRecipientDetails(
    orderId: string,
    details: {
      address: string;
      area: string;
      phone: string | null;
      note: string | null;
    },
  ): Promise<boolean> {
    const response = (await this.supabase
      .from('orders')
      .update({
        delivery_address: details.address,
        delivery_zone: details.area,
        delivery_phone: details.phone,
        delivery_note: details.note,
        delivery_details_at: new Date().toISOString(),
      })
      .eq('id', orderId)
      .eq('status', OrderStatus.FulfillmentInProgress)
      .select('id')) as Result<{ id: string }[]>;
    if (response.error) throw response.error;
    return (response.data ?? []).length > 0;
  }

  /** Forgets a sender-given address the shops can't serve, so the recipient is asked instead. */
  async clearDeliveryDetails(orderId: string): Promise<void> {
    const response = (await this.supabase
      .from('orders')
      .update({
        delivery_address: null,
        delivery_zone: null,
        delivery_phone: null,
        delivery_note: null,
        delivery_details_at: null,
      })
      .eq('id', orderId)
      .eq('status', OrderStatus.FulfillmentInProgress)) as {
      error: PostgrestError | null;
    };
    if (response.error) throw response.error;
  }

  /**
   * Hands the delivery to a vendor (or to a different one). Clears any
   * earlier "Got it": the new vendor hasn't said yes to anything.
   */
  async assignVendor(orderId: string, vendorId: string): Promise<boolean> {
    return this.updateOpen(
      orderId,
      {
        vendor_id: vendorId,
        status: FulfillmentStatus.VendorNotified,
        vendor_notified_at: new Date().toISOString(),
        vendor_accepted_at: null,
      },
      { notDispatched: true },
    );
  }

  /** The address changed under an assigned vendor: they need to see it again. */
  async clearAcknowledgement(orderId: string): Promise<void> {
    await this.updateOpen(
      orderId,
      {
        status: FulfillmentStatus.VendorNotified,
        vendor_accepted_at: null,
      },
      { notDispatched: true },
    );
  }

  async acknowledge(orderId: string, vendorId: string): Promise<boolean> {
    return this.updateOpen(
      orderId,
      {
        status: FulfillmentStatus.VendorAccepted,
        vendor_accepted_at: new Date().toISOString(),
      },
      { notDispatched: true, vendorId },
    );
  }

  async markDispatched(
    orderId: string,
    rider: { name: string | null; phone: string | null },
  ): Promise<boolean> {
    return this.updateOpen(
      orderId,
      {
        status: FulfillmentStatus.RiderDispatched,
        rider_name: rider.name,
        rider_phone: rider.phone,
        rider_dispatched_at: new Date().toISOString(),
      },
      { notDispatched: true },
    );
  }

  /**
   * The recipient's handover code — for the recipient's own gift page
   * only. Deliberately not in FULFILLMENT_COLUMNS, so it can't reach the
   * vendor's or ops' lists by accident.
   */
  async handoverCode(orderId: string): Promise<string | null> {
    const response = (await this.supabase
      .from('gift_fulfillments')
      .select('handover_code')
      .eq('order_id', orderId)
      .eq('fulfillment_type', FulfillmentType.Physical)
      .maybeSingle()) as Result<{ handover_code: string }>;
    if (response.error) throw response.error;
    return response.data?.handover_code ?? null;
  }

  /** One counted attempt, compared in the database under a lock — see try_handover_code(). */
  async tryHandoverCode(
    orderId: string,
    vendorId: string,
    code: string,
  ): Promise<HandoverCodeResult> {
    const response = (await this.supabase.rpc('try_handover_code', {
      p_order_id: orderId,
      p_vendor_id: vendorId,
      p_code: code,
    })) as Result<HandoverCodeResult>;
    if (response.error) throw response.error;
    return response.data ?? 'not_found';
  }

  async markDelivered(
    orderId: string,
    confirmedBy: 'code' | 'recipient' | 'ops',
  ): Promise<boolean> {
    return this.updateOpen(orderId, {
      status: FulfillmentStatus.Delivered,
      delivered_at: new Date().toISOString(),
      delivery_confirmation: confirmedBy,
    });
  }

  /**
   * "Couldn't deliver": recorded once. Guarded on the order still being in
   * delivery and not already marked failed, so a double tap is a no-op.
   */
  async markDeliveryFailed(orderId: string, reason: string): Promise<boolean> {
    const response = (await this.supabase
      .from('orders')
      .update({
        delivery_failed_at: new Date().toISOString(),
        delivery_failed_reason: reason,
      })
      .eq('id', orderId)
      .is('delivery_failed_at', null)
      .in('status', [OrderStatus.FulfillmentInProgress, OrderStatus.Dispatched])
      .select('id')) as Result<{ id: string }[]>;
    if (response.error) throw response.error;
    return (response.data ?? []).length > 0;
  }

  /**
   * Doorstep gifts paid for but still without an address, created before
   * `olderThan`, that haven't had both nudges. Oldest first.
   */
  async awaitingAddress(
    olderThan: Date,
    limit = 50,
  ): Promise<AwaitingAddressRow[]> {
    const response = (await this.supabase
      .from('orders')
      .select(
        'id, sender_name, recipient_name, recipient_phone, reveal_token, address_nudges, created_at, expires_at, gift_templates!gift_template_id!inner(name, delivery_type), users!sender_id(email, name)',
      )
      .eq('status', OrderStatus.FulfillmentInProgress)
      .is('delivery_address', null)
      .is('campaign_id', null)
      .lt('address_nudges', 2)
      .lt('created_at', olderThan.toISOString())
      .eq('gift_templates.delivery_type', FulfillmentType.Physical)
      .order('created_at', { ascending: true })
      .limit(limit)) as Result<AwaitingAddressRow[]>;
    if (response.error) throw response.error;
    return response.data ?? [];
  }

  /** Counts one nudge. Guarded on the count the job read, so two instances can't both send it. */
  async recordAddressNudge(orderId: string, from: number): Promise<boolean> {
    const response = (await this.supabase
      .from('orders')
      .update({
        address_nudges: from + 1,
        address_nudged_at: new Date().toISOString(),
      })
      .eq('id', orderId)
      .eq('address_nudges', from)
      .select('id')) as Result<{ id: string }[]>;
    if (response.error) throw response.error;
    return (response.data ?? []).length > 0;
  }

  /** Vendors holding an offering for this gift — the only ones who can be asked to deliver it. */
  async listCandidates(
    giftTemplateId: string,
  ): Promise<DeliveryCandidateRow[]> {
    const response = (await this.supabase
      .from('vendor_gift_offerings')
      .select(
        'vendor_price, available, approved, vendors(id, business_name, active, delivery_zones, service_areas)',
      )
      .eq('gift_template_id', giftTemplateId)) as Result<
      DeliveryCandidateRow[]
    >;
    if (response.error) throw response.error;
    return response.data ?? [];
  }

  /**
   * The vendor's share of what the sender paid for this order's gift
   * (vendorPayoutForOrder), excluding the delivery fee. Null when the
   * vendor has no offering for the gift.
   */
  async vendorPayout(
    vendorId: string,
    giftTemplateId: string,
    paidGiftValue: number,
  ): Promise<number | null> {
    const response = (await this.supabase
      .from('vendor_gift_offerings')
      .select('vendor_price, gift_templates(base_price)')
      .eq('vendor_id', vendorId)
      .eq('gift_template_id', giftTemplateId)
      .maybeSingle()) as Result<{
      vendor_price: number;
      gift_templates: { base_price: number } | null;
    }>;
    if (response.error) throw response.error;
    if (!response.data) return null;
    return vendorPayoutForOrder({
      vendorPrice: response.data.vendor_price,
      currentBasePrice:
        response.data.gift_templates?.base_price ?? paidGiftValue,
      paidGiftValue,
    });
  }

  async vendorName(vendorId: string): Promise<string | null> {
    const response = (await this.supabase
      .from('vendors')
      .select('business_name')
      .eq('id', vendorId)
      .maybeSingle()) as Result<{ business_name: string }>;
    if (response.error) throw response.error;
    return response.data?.business_name ?? null;
  }

  /**
   * Who delivered it and what they're owed — the same two columns a
   * counter collection writes, so Earnings and payouts need no special
   * case for deliveries. Write-once: a retried "Delivered" can never
   * re-price an order already credited.
   */
  async recordVendorCredit(
    orderId: string,
    vendorId: string,
    amount: number,
  ): Promise<void> {
    const response = (await this.supabase
      .from('orders')
      .update({ vendor_id: vendorId, vendor_payout_amount: amount })
      .eq('id', orderId)
      .is('vendor_payout_amount', null)) as { error: PostgrestError | null };
    if (response.error) throw response.error;
  }

  /**
   * Physical gifts not yet delivered, oldest first. Filtered to orders
   * still in the delivery part of their life — a refunded order's
   * fulfillment row stays open forever and must not sit on anyone's list.
   */
  async listOpen(vendorId?: string, limit = 200): Promise<OpenDeliveryRow[]> {
    let query = this.supabase
      .from('gift_fulfillments')
      .select(
        `${FULFILLMENT_COLUMNS}, orders!inner(${ORDER_COLUMNS}), vendors(business_name)`,
      )
      .eq('fulfillment_type', FulfillmentType.Physical)
      .is('delivered_at', null)
      .in('orders.status', [
        OrderStatus.FulfillmentInProgress,
        OrderStatus.Dispatched,
      ]);
    if (vendorId) query = query.eq('vendor_id', vendorId);
    const response = (await query
      .order('created_at', { ascending: true })
      .limit(limit)) as Result<OpenDeliveryRow[]>;
    if (response.error) throw response.error;
    return response.data ?? [];
  }

  private async updateOpen(
    orderId: string,
    values: Record<string, unknown>,
    guard: { notDispatched?: boolean; vendorId?: string } = {},
  ): Promise<boolean> {
    let query = this.supabase
      .from('gift_fulfillments')
      .update(values)
      .eq('order_id', orderId)
      .eq('fulfillment_type', FulfillmentType.Physical)
      .is('delivered_at', null);
    if (guard.notDispatched) query = query.is('rider_dispatched_at', null);
    if (guard.vendorId) query = query.eq('vendor_id', guard.vendorId);
    const response = (await query.select('order_id')) as Result<
      { order_id: string }[]
    >;
    if (response.error) throw response.error;
    return (response.data ?? []).length > 0;
  }
}
