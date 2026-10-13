/**
 * How SendEbun earns on a gift, sender side.
 *
 * Revenue model (locked 12 Oct 2026):
 *   - The gift is priced at the vendor's own in-store price — no markup.
 *     `gift_templates.base_price` IS that price.
 *   - The vendor gives Ebun a commission: `vendor_gift_offerings.vendor_price`
 *     is what Ebun pays them (default 90% of base_price, see
 *     vendors.commission_rate).
 *   - The sender pays a visible service fee on top, computed here.
 *   - Delivery, when it exists, is passed through at cost.
 *   - Ebun absorbs Paystack's fee out of the two above.
 *
 * Why a fee on the sender rather than a markup on the item: the sender,
 * especially from the diaspora, checks the price against what the gift
 * costs at the counter. A gift that costs more on SendEbun than in the
 * shop reads as a rip-off; a stated fee reads as a service.
 *
 * Configured from the environment, in kobo like every other amount, so
 * the rate can change without a code change. Each order stores the fee
 * it was charged (`orders.service_fee`), so changing the rate never
 * rewrites history.
 */
export interface ServiceFeePolicy {
  /** Basis points of the gift value: 500 = 5%. 0 turns the fee off entirely. */
  rateBps: number;
  /** Floor, kobo. Applied only when rateBps > 0. */
  minKobo: number;
  /** Ceiling, kobo. */
  maxKobo: number;
}

export const DEFAULT_SERVICE_FEE_POLICY: ServiceFeePolicy = {
  rateBps: 500, // 5%
  minKobo: 20_000, // ₦200
  maxKobo: 150_000, // ₦1,500
};

/**
 * Reads SERVICE_FEE_BPS / SERVICE_FEE_MIN_KOBO / SERVICE_FEE_MAX_KOBO.
 * Unset means the default. A set-but-malformed value throws, so the API
 * refuses to boot rather than charging senders something nobody chose —
 * same reasoning as resolvePort().
 */
export function resolveServiceFeePolicy(
  env: NodeJS.ProcessEnv = process.env,
): ServiceFeePolicy {
  const rateBps = readWholeNumber(
    env,
    'SERVICE_FEE_BPS',
    DEFAULT_SERVICE_FEE_POLICY.rateBps,
  );
  const minKobo = readWholeNumber(
    env,
    'SERVICE_FEE_MIN_KOBO',
    DEFAULT_SERVICE_FEE_POLICY.minKobo,
  );
  const maxKobo = readWholeNumber(
    env,
    'SERVICE_FEE_MAX_KOBO',
    DEFAULT_SERVICE_FEE_POLICY.maxKobo,
  );

  // 30% is already far beyond anything this model intends; a value above
  // it is almost certainly a units mistake, not a pricing decision.
  if (rateBps > 3_000) {
    throw new Error(
      `SERVICE_FEE_BPS is ${rateBps} (${rateBps / 100}%). It is in basis points: 500 means 5%.`,
    );
  }
  if (maxKobo < minKobo) {
    throw new Error(
      `SERVICE_FEE_MAX_KOBO (${maxKobo}) is below SERVICE_FEE_MIN_KOBO (${minKobo}).`,
    );
  }

  return { rateBps, minKobo, maxKobo };
}

/**
 * The fee on a gift of `giftValueKobo`.
 *
 * Rounded UP to a whole naira before the floor and ceiling apply, so a
 * checkout never shows kobo, and rounding never costs Ebun the fraction.
 */
/** ₦1,500 — a Lagos same-day bike run, roughly. Paid through to the delivering vendor. */
export const DEFAULT_DELIVERY_FEE_KOBO = 150_000;

/**
 * The flat delivery fee added to doorstep gifts (DELIVERY_FEE_KOBO).
 * Flat, not distance-priced: the recipient's address isn't known when the
 * sender pays — they give it after the reveal — so the only honest price
 * at checkout is one that doesn't depend on it.
 */
export function resolveDeliveryFeeKobo(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const fee = readWholeNumber(
    env,
    'DELIVERY_FEE_KOBO',
    DEFAULT_DELIVERY_FEE_KOBO,
  );
  // ₦20,000 for a delivery is a naira-typed-as-kobo slip in the other
  // direction (2000000), not a price.
  if (fee > 2_000_000) {
    throw new Error(
      `DELIVERY_FEE_KOBO is ${fee} (₦${fee / 100}). It is in kobo: 150000 means ₦1,500.`,
    );
  }
  return fee;
}

export function computeServiceFee(
  giftValueKobo: number,
  policy: ServiceFeePolicy,
): number {
  if (policy.rateBps === 0 || giftValueKobo <= 0) return 0;

  const raw = (giftValueKobo * policy.rateBps) / 10_000;
  const wholeNaira = Math.ceil(raw / 100) * 100;
  return Math.min(policy.maxKobo, Math.max(policy.minKobo, wholeNaira));
}

function readWholeNumber(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a whole number of zero or more: ${raw}`);
  }
  return value;
}
