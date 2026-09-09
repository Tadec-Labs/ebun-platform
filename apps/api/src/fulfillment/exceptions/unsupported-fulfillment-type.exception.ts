import { InternalServerErrorException } from '@nestjs/common';
import { FulfillmentType } from '@ebun/types';

/**
 * Thrown when orchestration is asked to fulfil an order whose
 * gift_template.delivery_type isn't handled yet. Phase 1 (this module)
 * only implements `digital_voucher` and `vtu` — the schema's own
 * documented reason both bypass vendor notification entirely
 * (order-state-machine.ts: "processing → fulfillment_in_progress —
 * VTU/digital bypasses vendor notification"). `physical` and
 * `experience` both route through vendor accept/decline/timeout, which
 * needs the vendor-marketplace module (not built yet — see the
 * project roadmap's "After these three" phase).
 *
 * Extends InternalServerErrorException (500), not BadRequestException —
 * this is never the caller's fault (the order was validated as
 * purchasable at creation time; nothing about THIS request is
 * malformed). It's Ebun's own roadmap gap. Should page ops, not be
 * treated as a client error to fix and retry.
 */
export class UnsupportedFulfillmentTypeException extends InternalServerErrorException {
  constructor(
    public readonly orderId: string,
    public readonly deliveryType: FulfillmentType,
  ) {
    super(
      `Order ${orderId} has delivery_type "${deliveryType}", which fulfillment ` +
        'orchestration does not implement yet (only digital_voucher and vtu are ' +
        'wired up). The order is left at "processing" — this needs the ' +
        'vendor-marketplace module before it can proceed automatically.',
    );
  }
}
