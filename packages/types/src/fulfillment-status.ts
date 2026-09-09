/**
 * Mirrors the Postgres `fulfillment_status` enum in
 * supabase/migrations/20260817040312_ebun_initial_schema.sql exactly.
 * Tracks `gift_fulfillments.status` — deliberately a separate vocabulary
 * from OrderStatus. The schema's own comment on gift_fulfillments says
 * why: "fulfillment state doesn't pollute order state." An order's
 * status answers "what stage of the sender→recipient lifecycle is this
 * gift at, from the outside" (paid, ready_for_redemption, etc). A
 * fulfillment's status answers "what is the vendor/VTU/voucher process
 * doing right now, on the inside" (vtu_processing, rider_dispatched,
 * etc) — a finer-grained, type-specific log that orders.status alone
 * can't express without conflating physical/digital/VTU concerns.
 *
 * As with OrderStatus, this file is vocabulary only — no transition
 * graph. Which fulfillment_status values are legal for which
 * fulfillment_type, and in what order, is business logic that lives in
 * apps/api (see apps/api/src/fulfillment/).
 */
export enum FulfillmentStatus {
  Pending = 'pending',
  VendorNotified = 'vendor_notified',
  VendorAccepted = 'vendor_accepted',
  VendorDeclined = 'vendor_declined',
  VendorTimeout = 'vendor_timeout',
  InProgress = 'in_progress',
  RiderDispatched = 'rider_dispatched',
  Delivered = 'delivered',
  VoucherGenerated = 'voucher_generated',
  VtuProcessing = 'vtu_processing',
  VtuComplete = 'vtu_complete',
  Completed = 'completed',
  Failed = 'failed',
  Cancelled = 'cancelled',
}
