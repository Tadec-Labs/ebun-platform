/**
 * Group gifting settings. Kept in one file so the product rules read in
 * one place, and so the numbers a contributor sees are the numbers the
 * code enforces.
 */

/** Reference prefix for a contribution checkout (a sender's is ebun_, a company's ebcmp_). */
export const GROUP_REFERENCE_PREFIX = 'ebgrp_';

/**
 * Smallest share, kobo (₦1,000). Below this the per-share Paystack cost
 * and the fee floor take too big a bite of what the person gave. The
 * last share may be smaller: whatever is left to reach the target.
 */
export const MIN_CONTRIBUTION_KOBO = 100_000;

/** A pot runs at least an hour (so the link can be shared) and at most 30 days. */
export const MIN_DEADLINE_MINUTES = 60;
export const MAX_DEADLINE_DAYS = 30;

/** One extension, of up to 7 days past the original deadline. */
export const MAX_EXTENSION_DAYS = 7;

/**
 * After the deadline, the organiser has this long to top up, switch to a
 * gift the pot covers, or extend. With no decision, the pot closes and
 * everyone is refunded in full. Never a "failed" gift by surprise.
 */
export const DECISION_WINDOW_HOURS = 48;

/** Refunds the worker sends per run, and how often it retries a network failure. */
export const REFUND_BATCH = 25;
export const MAX_REFUND_ATTEMPTS = 5;

/**
 * GROUP_GIFTING=true opens the public endpoints. Unset: creating a pot
 * and contributing are 404s. Gifts already created keep working either
 * way: their reveal, the refunds owed and the organiser page.
 */
export function groupGiftingEnabled(raw: string | undefined): boolean {
  return raw?.trim().toLowerCase() === 'true';
}
