import { OrderStatus } from '@ebun/types';

/**
 * What a sender's post-payment page is allowed to know. Deliberately a
 * coarse three-way bucket rather than the raw OrderStatus: this endpoint
 * is public (keyed only by the unguessable Paystack reference), and
 * internal states like vendor_declined or fulfillment_failed are
 * operational detail the sender's "did my payment go through" page has
 * no business exposing — or being able to misread.
 */
export type OrderConfirmationStatus =
  'awaiting_payment' | 'confirmed' | 'unsuccessful';

export interface OrderConfirmationView {
  status: OrderConfirmationStatus;
  orderNumber: string | null;
  recipientName: string;
}

const AWAITING_PAYMENT = new Set<OrderStatus>([
  OrderStatus.Draft,
  OrderStatus.PendingPayment,
]);

// Refunded is here because "your order didn't complete" is the honest
// message for someone revisiting this page after a refund — not "payment
// received".
const UNSUCCESSFUL = new Set<OrderStatus>([
  OrderStatus.PaymentFailed,
  OrderStatus.Cancelled,
  OrderStatus.Refunded,
]);

/**
 * Everything not explicitly awaiting or unsuccessful counts as
 * 'confirmed' — including later failure states like fulfillment_failed
 * and expired. This page answers exactly one question (was the payment
 * received?), and in all of those states it was; what happens to the
 * gift afterwards is a separate flow with its own notifications.
 */
export function toConfirmationStatus(
  status: OrderStatus,
): OrderConfirmationStatus {
  if (AWAITING_PAYMENT.has(status)) return 'awaiting_payment';
  if (UNSUCCESSFUL.has(status)) return 'unsuccessful';
  return 'confirmed';
}
