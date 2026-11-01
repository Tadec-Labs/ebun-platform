/**
 * Event settings: the product rules in one place, so the numbers a
 * guest or host sees are the numbers the code enforces.
 */

/** Reference prefix for a guest's cash gift checkout (a sender's is ebun_, a pot share's ebgrp_). */
export const EVENT_REFERENCE_PREFIX = 'ebevt_';

export const EVENT_TYPES = [
  'wedding',
  'engagement',
  'birthday',
  'baby',
  'send_forth',
  'remembrance',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Smallest cash gift, kobo (₦500), and largest (₦5,000,000) — a fat-finger guard, not a policy. */
export const MIN_CASH_KOBO = 50_000;
export const MAX_CASH_KOBO = 500_000_000;

/** An event can be set up to a year ahead. */
export const MAX_DAYS_AHEAD = 365;

/**
 * Giving stays open this many days after the event date (guests who
 * couldn't come, late gifts). Then cash closes, gift-list pots reach
 * their deadline, and the host's payout can be made.
 */
export const GIVING_DAYS_AFTER = 3;

/** At most this many gift-list items per event. */
export const MAX_ITEMS = 40;

/** Refund worker batch and retries, as for group gifts. */
export const REFUND_BATCH = 25;
export const MAX_REFUND_ATTEMPTS = 5;

/** Lagos is UTC+1 all year (no daylight saving). */
const LAGOS_OFFSET_HOURS = 1;

/** EVENTS=true opens event pages: creating one, viewing it, the wall. */
export function eventsEnabled(raw: string | undefined): boolean {
  return raw?.trim().toLowerCase() === 'true';
}

/**
 * EVENTS_CASH=true lets guests give cash. Off until Paystack has
 * approved SendEbun collecting cash gifts for hosts. Events still work
 * with gift lists only.
 */
export function eventsCashEnabled(raw: string | undefined): boolean {
  return raw?.trim().toLowerCase() === 'true';
}

/**
 * The most an unverified host's event can take in cash, kobo. Default
 * ₦500,000. 0 = no cap (not recommended). A gift that would cross it is
 * refused at checkout, and refunded if it lands anyway.
 */
export function cashCapKobo(raw: string | undefined): number {
  return wholeNumber(raw, 'EVENT_CASH_CAP_KOBO', 50_000_000);
}

/** SendEbun's fee on a host's cash payout, basis points. Default 0: guests already pay a service fee. */
export function hostFeeBps(raw: string | undefined): number {
  const bps = wholeNumber(raw, 'EVENT_HOST_FEE_BPS', 0);
  if (bps > 2_000) {
    throw new Error(
      `EVENT_HOST_FEE_BPS is ${bps}: more than 20% is a typo, not a fee.`,
    );
  }
  return bps;
}

function wholeNumber(
  raw: string | undefined,
  name: string,
  fallback: number,
): number {
  const value = raw?.trim();
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a whole number of zero or more: ${value}`);
  }
  return parsed;
}

/** "2026-12-12" -> that calendar day's parts, or null if it isn't a real date. */
export function parseEventDate(
  value: string,
): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  ];
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

/** A Lagos wall-clock time on the event date plus `plusDays`, as an instant. */
export function lagosTime(
  eventDate: string,
  plusDays: number,
  hour: number,
  minute = 0,
): Date {
  const parts = parseEventDate(eventDate);
  if (!parts) throw new Error(`Not an event date: ${eventDate}`);
  return new Date(
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day + plusDays,
      hour - LAGOS_OFFSET_HOURS,
      minute,
    ),
  );
}

/** When giving closes: 23:59 Lagos time, GIVING_DAYS_AFTER days after the date. */
export function givingClosesAt(eventDate: string): Date {
  return lagosTime(eventDate, GIVING_DAYS_AFTER, 23, 59);
}

/** Gift-list gifts reach the host the morning after the event (09:00 Lagos). */
export function giftsSendAt(eventDate: string): Date {
  return lagosTime(eventDate, 1, 9, 0);
}

/** Today's date in Lagos, "YYYY-MM-DD". */
export function lagosToday(now: Date = new Date()): string {
  return new Date(now.getTime() + LAGOS_OFFSET_HOURS * 3_600_000)
    .toISOString()
    .slice(0, 10);
}
