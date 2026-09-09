/**
 * Mirrors the Postgres `fulfillment_type` enum in
 * supabase/migrations/20260817040312_ebun_initial_schema.sql exactly.
 * Lives on `gift_templates.delivery_type` — this is what an order's
 * fulfillment orchestration branches on, not something set per-order.
 *
 * Same "plain string enum" rationale as OrderStatus (see order-status.ts):
 * isolatedModules forbids const enum, and string values round-trip
 * through Postgres/Supabase without a mapping layer.
 */
export enum FulfillmentType {
  Physical = 'physical',
  DigitalVoucher = 'digital_voucher',
  Vtu = 'vtu',
  Experience = 'experience',
}
