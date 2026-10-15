import { Inject, Injectable } from '@nestjs/common';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import {
  FulfillmentType,
  NotificationChannel,
  NotificationStatus,
  OrderStatus,
} from '@ebun/types';
import { SUPABASE_CLIENT } from '../supabase/supabase.module';

/** How to reach a vendor, for alerts. */
export interface VendorContactRow {
  id: string;
  business_name: string;
  email: string | null;
  whatsapp_number: string;
  backup_phone: string | null;
}

/** A delivery assigned to a vendor that nobody has said "Got it" to. */
export interface UnacknowledgedDeliveryRow {
  order_id: string;
  vendor_id: string;
  vendor_notified_at: string;
  orders: {
    order_number: string | null;
    status: OrderStatus;
    delivery_zone: string | null;
    gift_templates: { name: string } | null;
  } | null;
  vendors: VendorContactRow | null;
}

/** A collection booking the vendor hasn't confirmed. */
export interface UnconfirmedPickupRow {
  id: string;
  order_number: string | null;
  recipient_name: string;
  pickup_at: string;
  pickup_booked_at: string;
  pickup_vendor_id: string;
  gift_templates: { name: string } | null;
  vendors: VendorContactRow | null;
}

/** What delivery/pickup emails need about an order. */
export interface AlertOrderRow {
  id: string;
  order_number: string | null;
  recipient_name: string;
  recipient_phone: string;
  delivery_address: string | null;
  delivery_zone: string | null;
  delivery_phone: string | null;
  delivery_note: string | null;
  gift_templates: { name: string } | null;
}

const CONTACT_COLUMNS =
  'id, business_name, email, whatsapp_number, backup_phone';

type Result<T> = { data: T | null; error: PostgrestError | null };

@Injectable()
export class VendorAlertsRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async vendorContact(vendorId: string): Promise<VendorContactRow | null> {
    const response = (await this.supabase
      .from('vendors')
      .select(CONTACT_COLUMNS)
      .eq('id', vendorId)
      .maybeSingle()) as Result<VendorContactRow>;
    if (response.error) throw response.error;
    return response.data ?? null;
  }

  async order(orderId: string): Promise<AlertOrderRow | null> {
    const response = (await this.supabase
      .from('orders')
      .select(
        'id, order_number, recipient_name, recipient_phone, delivery_address, delivery_zone, delivery_phone, delivery_note, gift_templates!gift_template_id(name)',
      )
      .eq('id', orderId)
      .maybeSingle()) as Result<AlertOrderRow>;
    if (response.error) throw response.error;
    return response.data ?? null;
  }

  async unacknowledgedDeliveries(
    olderThan: Date,
  ): Promise<UnacknowledgedDeliveryRow[]> {
    const response = (await this.supabase
      .from('gift_fulfillments')
      .select(
        `order_id, vendor_id, vendor_notified_at, orders!inner(order_number, status, delivery_zone, gift_templates!gift_template_id(name)), vendors(${CONTACT_COLUMNS})`,
      )
      .eq('fulfillment_type', FulfillmentType.Physical)
      .not('vendor_id', 'is', null)
      .is('vendor_accepted_at', null)
      .is('rider_dispatched_at', null)
      .is('delivered_at', null)
      .lt('vendor_notified_at', olderThan.toISOString())
      .eq('orders.status', OrderStatus.FulfillmentInProgress)
      .limit(100)) as Result<UnacknowledgedDeliveryRow[]>;
    if (response.error) throw response.error;
    return response.data ?? [];
  }

  /**
   * Booked more than the threshold ago, still unconfirmed, and not long
   * past — a booking for yesterday is history, not an alert.
   */
  async unconfirmedPickups(
    bookedBefore: Date,
    pickupAfter: Date,
  ): Promise<UnconfirmedPickupRow[]> {
    // orders references vendors twice (vendor_id, pickup_vendor_id): the
    // embed names the column it follows.
    const response = (await this.supabase
      .from('orders')
      .select(
        `id, order_number, recipient_name, pickup_at, pickup_booked_at, pickup_vendor_id, gift_templates!gift_template_id(name), vendors!pickup_vendor_id(${CONTACT_COLUMNS})`,
      )
      .eq('status', OrderStatus.RevealOpened)
      .not('pickup_vendor_id', 'is', null)
      .is('pickup_confirmed_at', null)
      .lt('pickup_booked_at', bookedBefore.toISOString())
      .gt('pickup_at', pickupAfter.toISOString())
      .limit(100)) as Result<UnconfirmedPickupRow[]>;
    if (response.error) throw response.error;
    return response.data ?? [];
  }

  /**
   * Claims an alert before sending it. The idempotency key is unique in
   * the table, so the second claim for the same alert — a retried
   * request, an overlapping sweep — returns null and nothing is sent
   * twice.
   */
  async claim(params: {
    /** Null for alerts about a vendor rather than an order (a new item, a price request). */
    orderId: string | null;
    recipientType: 'vendor' | 'admin';
    email: string;
    notificationType: string;
    subject: string;
    idempotencyKey: string;
  }): Promise<string | null> {
    const response = (await this.supabase
      .from('notifications')
      .insert({
        order_id: params.orderId,
        recipient_type: params.recipientType,
        recipient_email: params.email,
        channel: NotificationChannel.Email,
        notification_type: params.notificationType,
        status: NotificationStatus.Pending,
        provider: 'resend',
        payload: { subject: params.subject },
        idempotency_key: params.idempotencyKey,
      })
      .select('id')
      .single()) as Result<{ id: string }>;
    if (response.error) {
      if (response.error.code === '23505') return null;
      throw response.error;
    }
    return response.data?.id ?? null;
  }

  async markSent(id: string, providerMessageId: string): Promise<void> {
    const { error } = await this.supabase
      .from('notifications')
      .update({
        status: NotificationStatus.Sent,
        provider_message_id: providerMessageId,
        sent_at: new Date().toISOString(),
      })
      .eq('id', id);
    if (error) throw error;
  }

  async markFailed(id: string, message: string): Promise<void> {
    const { error } = await this.supabase
      .from('notifications')
      .update({
        status: NotificationStatus.Failed,
        error_message: message.slice(0, 500),
        failed_at: new Date().toISOString(),
      })
      .eq('id', id);
    if (error) throw error;
  }
}
