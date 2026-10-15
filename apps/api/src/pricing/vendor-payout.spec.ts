import { vendorPayoutForOrder } from './vendor-payout';

describe('vendorPayoutForOrder', () => {
  it('pays exactly the agreed vendor price when the price has not moved', () => {
    expect(
      vendorPayoutForOrder({
        vendorPrice: 720_000,
        currentBasePrice: 800_000,
        paidGiftValue: 800_000,
      }),
    ).toBe(720_000);
  });

  it('keeps kobo in an agreed price when nothing moved (no naira rounding)', () => {
    expect(
      vendorPayoutForOrder({
        vendorPrice: 560_050,
        currentBasePrice: 700_000,
        paidGiftValue: 700_000,
      }),
    ).toBe(560_050);
  });

  it('after a price RISE, pays the share of what the sender paid, not of the new price', () => {
    // Bought at ₦8,000; price approved up to ₦10,000 (share ₦9,000) before
    // collection. Paying ₦9,000 on ₦8,000 would lose money on the order.
    expect(
      vendorPayoutForOrder({
        vendorPrice: 900_000,
        currentBasePrice: 1_000_000,
        paidGiftValue: 800_000,
      }),
    ).toBe(720_000);
  });

  it('after a price DROP, still pays the share of what the sender paid', () => {
    expect(
      vendorPayoutForOrder({
        vendorPrice: 720_000,
        currentBasePrice: 800_000,
        paidGiftValue: 1_000_000,
      }),
    ).toBe(900_000);
  });

  it('rounds a scaled share down to whole naira', () => {
    // 650,000 × 0.9 = 585,000 exactly; 655,550 × 0.9 = 589,995 → ₦5,899.
    expect(
      vendorPayoutForOrder({
        vendorPrice: 900_000,
        currentBasePrice: 1_000_000,
        paidGiftValue: 655_550,
      }),
    ).toBe(589_900);
  });

  it('never pays out more than the gift was sold for, even if a price is mis-set', () => {
    expect(
      vendorPayoutForOrder({
        vendorPrice: 1_200_000,
        currentBasePrice: 1_000_000,
        paidGiftValue: 1_000_000,
      }),
    ).toBe(1_000_000);
    expect(
      vendorPayoutForOrder({
        vendorPrice: 1_200_000,
        currentBasePrice: 1_000_000,
        paidGiftValue: 900_000,
      }),
    ).toBe(900_000);
  });
});
