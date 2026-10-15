/**
 * What SendEbun owes a vendor for handing over one order's gift.
 *
 * The vendor's share of what the SENDER PAID for the gift — not of
 * today's price.
 *
 * Payouts are worked out at hand-over (for a collection, nobody knows
 * which vendor is owed until then), from the offering as it is at that
 * moment. Prices move: a vendor can ask for a new price and ops can
 * approve it while gifts bought at the old one are still waiting to be
 * collected. Paying today's share on yesterday's sale would mean:
 *
 *   bought at ₦8,000 → price rises to ₦10,000 → payout ₦9,000
 *   on ₦8,000 the sender paid. SendEbun loses money on the order.
 *
 * So the agreed share (vendor_price / base_price, as they stand now) is
 * applied to the gift value stored on the order at purchase. With no
 * price change in between — the normal case — gift value equals the
 * current price and the payout is exactly vendor_price, as before.
 *
 * Never more than the gift value itself: a share above 100% only exists
 * if a price was mis-set, and then the order's own value is the ceiling.
 * Rounded down to whole naira when it has to be scaled, like every
 * vendor share (see vendorShareOf).
 */
export function vendorPayoutForOrder(input: {
  /** kobo — the offering's vendor_price now. */
  vendorPrice: number;
  /** kobo — the gift's base_price now. */
  currentBasePrice: number;
  /** kobo — orders.gift_value, what the sender paid for the gift itself. */
  paidGiftValue: number;
}): number {
  const { vendorPrice, currentBasePrice, paidGiftValue } = input;

  if (paidGiftValue === currentBasePrice || currentBasePrice <= 0) {
    return Math.min(vendorPrice, paidGiftValue);
  }

  // Integer maths first, so float noise can't knock a naira off.
  const scaled = Math.floor((paidGiftValue * vendorPrice) / currentBasePrice);
  const wholeNaira = Math.floor(scaled / 100) * 100;
  return Math.min(wholeNaira, paidGiftValue);
}
