import { Injectable } from '@nestjs/common';
import { FulfillmentType } from '@ebun/types';
import {
  computeServiceFee,
  resolveDeliveryFeeKobo,
  resolveServiceFeePolicy,
  ServiceFeePolicy,
} from './service-fee';

export interface GiftPrice {
  /** The gift itself, kobo — the vendor's in-store price. */
  giftValue: number;
  serviceFee: number;
  /** Doorstep gifts only (DELIVERY_FEE_KOBO); 0 for everything collected or digital. Passed through to the vendor who delivers. */
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
  private readonly deliveryFeeKobo: number;

  constructor() {
    this.policy = resolveServiceFeePolicy();
    this.deliveryFeeKobo = resolveDeliveryFeeKobo();
  }

  /**
   * The service fee is on the gift alone, never on the delivery fee:
   * SendEbun doesn't earn a cut of the rider's money.
   */
  priceGift(giftValue: number, deliveryType?: FulfillmentType): GiftPrice {
    const serviceFee = computeServiceFee(giftValue, this.policy);
    const deliveryFee =
      deliveryType === FulfillmentType.Physical ? this.deliveryFeeKobo : 0;
    return {
      giftValue,
      serviceFee,
      deliveryFee,
      total: giftValue + serviceFee + deliveryFee,
    };
  }
}
