/**
 * Mirrors the Postgres `redemption_status` enum in
 * supabase/migrations/20260817040312_ebun_initial_schema.sql exactly.
 * Vocabulary only — RedemptionsService owns which transitions are legal
 * (in practice: pending -> initiated -> completed, or -> failed/expired,
 * enforced by the atomic attempt_redemption() RPC, not by NestJS).
 */
export enum RedemptionStatus {
  Pending = 'pending',
  Initiated = 'initiated',
  Completed = 'completed',
  Failed = 'failed',
  Expired = 'expired',
}
