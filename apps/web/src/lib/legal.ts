/**
 * The facts every legal page states, in one place.
 *
 * Paystack's compliance review, the Nigeria Data Protection Commission
 * and customers all read these pages, and the details must match the
 * CAC certificate and the Meta Business profile exactly. Change them
 * here and every page follows.
 */
export const LEGAL = {
  brand: "Ebun",
  /** Exactly as on the CAC business name certificate. */
  entity: "TADECLABS INNOVATIONS",
  entityDescription:
    "a business name registered with the Corporate Affairs Commission of Nigeria",
  address:
    "Afro-Stuff Estate, Alagbaka Estate, Akure, Ondo State 340223, Nigeria",
  email: "theo@ebun.com.ng",
  phone: "+234 906 704 2371",
  website: "www.ebun.com.ng",
  /** Shown as "Last updated". Change it whenever a page's substance changes. */
  lastUpdated: "11 October 2026",
  /** Matches orders.expires_at (now() + 30 days) in the schema. */
  giftValidityDays: 30,
  /** Paystack refunds land on the original card or account; banks vary. */
  refundWorkingDays: 10,
} as const;
