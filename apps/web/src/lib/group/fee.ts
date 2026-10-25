import type { FeePolicy } from "./types";

/**
 * The fee on one share, shown as the contributor types. Same arithmetic
 * as apps/api/src/pricing/service-fee.ts computeServiceFee — rate,
 * rounded UP to a whole naira, then the floor and ceiling — applied to
 * the policy the API sends with the pot, so the number on screen is the
 * number Paystack charges. The API still computes the real total; this
 * only previews it.
 */
export function shareFee(amountKobo: number, policy: FeePolicy): number {
  if (policy.rateBps === 0 || amountKobo <= 0) return 0;
  const raw = (amountKobo * policy.rateBps) / 10_000;
  const wholeNaira = Math.ceil(raw / 100) * 100;
  return Math.min(policy.maxKobo, Math.max(policy.minKobo, wholeNaira));
}
