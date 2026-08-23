/**
 * Canonical order lifecycle states.
 *
 * MUST mirror the Postgres `order_status` enum in
 * supabase/migrations/20260817040312_ebun_initial_schema.sql exactly —
 * same labels, same casing (verified against the live migration file
 * itself, not just the reference doc). This is the single vocabulary
 * both apps/api and apps/web import from.
 *
 * There is no `supabase gen types typescript` step wired into the build
 * yet, so this enum is maintained by hand. If the DB enum changes, this
 * file must change with it in the same PR — nothing enforces that
 * automatically today.
 *
 * A plain (non-const) TypeScript enum is used deliberately:
 *  - apps/api's tsconfig has `isolatedModules: true`, which forbids
 *    `const enum` (const enums require whole-program inlining;
 *    isolatedModules requires every file to be transpilable alone).
 *  - String values means `OrderStatus.Paid === 'paid'` at runtime, so
 *    it round-trips through Postgres/Supabase without a mapping layer.
 *  - Regular enums are iterable via `Object.values()`. That's used in
 *    apps/api's tests to assert every member has transition-table
 *    coverage — NOT to derive the transitions themselves. The
 *    transition graph is written out explicitly, state by state; see
 *    apps/api/src/orders/order-state-machine.ts for why that
 *    distinction is deliberate.
 *
 * This file contains ONLY the vocabulary — no transition logic. Which
 * transitions are legal is business logic and lives exclusively in
 * apps/api. Do not add a transition graph here.
 */
export enum OrderStatus {
  Draft = 'draft',
  PendingPayment = 'pending_payment',
  Paid = 'paid',
  Processing = 'processing',
  VendorNotified = 'vendor_notified',
  VendorAccepted = 'vendor_accepted',
  VendorDeclined = 'vendor_declined',
  VendorTimeout = 'vendor_timeout',
  FulfillmentInProgress = 'fulfillment_in_progress',
  Dispatched = 'dispatched',
  Delivered = 'delivered',
  VoucherIssued = 'voucher_issued',
  ReadyForRedemption = 'ready_for_redemption',
  RevealOpened = 'reveal_opened',
  Redeemed = 'redeemed',
  Fulfilled = 'fulfilled',
  PaymentFailed = 'payment_failed',
  FulfillmentFailed = 'fulfillment_failed',
  RedemptionFailed = 'redemption_failed',
  Expired = 'expired',
  Cancelled = 'cancelled',
  Refunded = 'refunded',
}