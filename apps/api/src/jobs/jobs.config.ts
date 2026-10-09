/**
 * Shared settings for the background jobs.
 *
 * MULTI-INSTANCE NOTE — read before scaling past one Railway instance.
 * Every job below runs on every instance. That is safe today, but by
 * construction rather than by luck:
 *   - order transitions go through attempt_order_transition(), an
 *     atomic compare-and-swap, so a second instance racing on the same
 *     order loses rather than double-applying;
 *   - notification sends are gated by notifications.idempotency_key,
 *     which is UNIQUE;
 *   - the stuck-order sweep only reads.
 * The cost of two instances is duplicated queries and one wasted
 * transition attempt, not a double send or a double transition. A
 * proper advisory lock belongs here before the job list grows anything
 * that is NOT individually idempotent.
 */

/**
 * How long an order may sit mid-fulfilment before it is considered
 * stuck. Fulfilment runs inside the Paystack webhook request and
 * involves no slow external call for vouchers, so anything past a few
 * minutes has failed rather than queued. Fifteen leaves room for a
 * genuinely slow VTU provider later without crying wolf.
 */
export const STUCK_FULFILLMENT_MINUTES = 15;

/** Batch ceilings — a sweep that falls behind should take several passes, not one unbounded query. */
export const SCHEDULED_SEND_BATCH = 50;
export const EXPIRY_BATCH = 200;
export const STUCK_SCAN_BATCH = 100;
export const RETRY_BATCH = 25;

/**
 * Set ENABLE_BACKGROUND_JOBS=false to stop every job from firing.
 *
 * This exists mainly so a developer running the API locally against the
 * shared Supabase project does not quietly expire production orders or
 * fire real WhatsApp messages from their laptop. Defaults to enabled,
 * so deployments need no new configuration to behave correctly.
 */
export function backgroundJobsEnabled(raw: string | undefined): boolean {
  return raw?.trim().toLowerCase() !== 'false';
}
