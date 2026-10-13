/**
 * The catalogue's vocabulary, shared by the API (validation) and the web
 * app (labels, filters). One list, so the two can't drift: a category the
 * API accepts always has a label on /send, and vice versa. The database
 * enforces the same lists (20261014090000_catalogue_v2.sql) — change all
 * three together.
 */

export const GIFT_CATEGORIES = [
  'treats',
  'dine',
  'pamper',
  'experiences',
  'hampers',
  'flowers',
  'utility',
] as const;
export type GiftCategory = (typeof GIFT_CATEGORIES)[number];

export const GIFT_CATEGORY_LABEL: Record<GiftCategory, string> = {
  treats: 'Treats',
  dine: 'Dine',
  pamper: 'Pamper',
  experiences: 'Experiences',
  hampers: 'Hampers & care',
  flowers: 'Flowers & keepsakes',
  // Kept so the airtime/data path still validates; not marketed.
  utility: 'Bills & top-ups',
};

export const OCCASIONS = [
  'birthday',
  'thank_you',
  'congratulations',
  'love',
  'just_because',
  'get_well',
  'new_baby',
  'festive',
] as const;
export type Occasion = (typeof OCCASIONS)[number];

export const OCCASION_LABEL: Record<Occasion, string> = {
  birthday: 'Birthday',
  thank_you: 'Thank you',
  congratulations: 'Congratulations',
  love: 'Love',
  just_because: 'Just because',
  get_well: 'Get well',
  new_baby: 'New baby',
  festive: 'Festive',
};

/**
 * How a collected (voucher) gift is redeemed, which decides the
 * recipient's wording: "When are you collecting?" vs "Book your
 * appointment". Delivered gifts use FulfillmentType.Physical instead.
 */
export const BOOKING_STYLES = ['pickup', 'appointment'] as const;
export type BookingStyle = (typeof BOOKING_STYLES)[number];
