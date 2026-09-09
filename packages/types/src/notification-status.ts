/**
 * Mirrors the Postgres `notification_status` enum in
 * supabase/migrations/20260817040312_ebun_initial_schema.sql exactly.
 * Vocabulary only, same as OrderStatus/FulfillmentStatus — no transition
 * graph here. NotificationsRepository/Service in apps/api own which
 * transitions are legal.
 */
export enum NotificationStatus {
  Pending = 'pending',
  Sent = 'sent',
  Delivered = 'delivered',
  Failed = 'failed',
  Retrying = 'retrying',
  Cancelled = 'cancelled',
}
