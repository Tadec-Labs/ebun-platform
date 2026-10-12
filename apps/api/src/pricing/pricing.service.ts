import { Injectable } from '@nestjs/common';
import {
  computeServiceFee,
  resolveServiceFeePolicy,
  ServiceFeePolicy,
} from './service-fee';

export interface GiftPrice {
  /** The gift itself, kobo — the vendor's in-store price. */
  giftValue: number;
  serviceFee: number;
  /** Not charged yet: nothing delivered is on sale. Kept explicit so the total is honest about its parts. */
  deliveryFee: number;
  total: number;
}

/**
 * The one place a sender-facing price is worked out. The public
 * catalogue and order creation both ask here, so the total a sender
 * reads before paying is, by construction, the total Paystack charges.
 *
 * The policy is resolved once, at construction: a malformed fee setting
 * fails the boot, not a checkout.
 */
@Injectable()
export class PricingService {
  private readonly policy: ServiceFeePolicy;

  constructor() {
    this.policy = resolveServiceFeePolicy();
  }

  priceGift(giftValue: number): GiftPrice {
    const serviceFee = computeServiceFee(giftValue, this.policy);
    const deliveryFee = 0;
    return {
      giftValue,
      serviceFee,
      deliveryFee,
      total: giftValue + serviceFee + deliveryFee,
    };
  }
}
