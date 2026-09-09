import { randomUUID } from 'crypto';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { FulfillmentStatus, FulfillmentType, OrderStatus } from '@ebun/types';
import { OrdersService } from '../orders/orders.service';
import { OrderRow } from '../orders/orders.repository';
import { GiftsService } from '../gifts/gifts.service';
import { GiftFulfillmentsRepository } from './gift-fulfillments.repository';
import { DigitalVoucherService } from './digital-voucher.service';
import { NotificationsService } from '../notifications/notifications.service';
import { VTU_PROVIDER } from './vtu-provider.interface';
import type { VtuProviderService } from './vtu-provider.interface';
import { UnsupportedFulfillmentTypeException } from './exceptions/unsupported-fulfillment-type.exception';

/**
 * Entry point for Phase 1 fulfillment: walks a `paid` order through
 * `processing → fulfillment_in_progress → {voucher_issued | ready_for_redemption}`
 * for the two fulfillment types that bypass vendor notification entirely
 * (digital_voucher, vtu — see order-state-machine.ts's SCHEMA-tagged
 * comment on why those two skip vendor_notified). `physical` and
 * `experience` both need the vendor-marketplace module, which doesn't
 * exist yet — see UnsupportedFulfillmentTypeException.
 *
 * INVOCATION & FAILURE MODE — read before wiring this in elsewhere:
 * Called synchronously from PaystackWebhookService right after payment
 * is confirmed, in the same request, not decoupled via a queue or cron
 * poll. This is a deliberate choice given the schema's own framing of
 * VTU as "instant API" and digital_voucher generation needing no
 * external call at all — there's no slow step to hide behind
 * asynchrony YET (a real VTU provider call might change that
 * calculus). The trade-off: if this method throws partway through (see
 * below), the order is left stuck at whatever intermediate status it
 * reached, and — because the Paystack webhook's idempotency key was
 * already claimed before this runs — a webhook redelivery will NOT
 * retry it; that idempotency check short-circuits before this
 * orchestrator would ever run again. Recovering a stuck order today
 * requires manual ops intervention. This is the same category of gap
 * already flagged for stale `draft` orders (no cleanup path) — noted
 * here rather than silently accepted, and a candidate for a future
 * cron sweep (order status stuck in processing/fulfillment_in_progress
 * past some threshold), NOT solved in this slice.
 *
 * Each transitionNormal() call uses the order's OWN current `status` as
 * `from`, re-read via findById moments earlier rather than assumed —
 * same defensive pattern PaystackWebhookService already uses for the
 * paid transition. If two invocations ever raced for the same order,
 * the atomic compare-and-swap in attempt_order_transition() ensures at
 * most one proceeds; the other fails loudly (InvalidOrderTransitionException
 * or OrderTransitionConflictException) rather than double-fulfilling.
 */
@Injectable()
export class FulfillmentOrchestratorService {
  private readonly logger = new Logger(FulfillmentOrchestratorService.name);

  constructor(
    private readonly ordersService: OrdersService,
    private readonly giftsService: GiftsService,
    private readonly fulfillments: GiftFulfillmentsRepository,
    private readonly digitalVoucher: DigitalVoucherService,
    private readonly notifications: NotificationsService,
    @Inject(VTU_PROVIDER) private readonly vtuProvider: VtuProviderService,
  ) {}

  async start(orderId: string): Promise<void> {
    const order = await this.ordersService.findById(orderId);
    if (!order) {
      // Should not happen in practice — the caller (PaystackWebhookService)
      // already loaded this exact order moments earlier. Thrown rather than
      // silently no-op'd, matching the codebase's "loud over silent" bias.
      throw new NotFoundException(
        `Order ${orderId} not found — cannot begin fulfillment`,
      );
    }

    // findAvailableById is deliberately NOT used here — .available governs
    // whether a template can be picked for a NEW order, not whether an
    // order already paid for still deserves fulfilling. See GiftsService.
    const giftTemplate = await this.giftsService.findById(
      order.gift_template_id,
    );

    await this.ordersService.transitionNormal(
      order.id,
      order.status,
      OrderStatus.Processing,
      { type: 'system' },
    );

    switch (giftTemplate.delivery_type) {
      case FulfillmentType.DigitalVoucher:
        await this.fulfilDigitalVoucher(order);
        return;
      case FulfillmentType.Vtu:
        await this.fulfilVtu(order);
        return;
      default:
        // physical | experience — left at 'processing', see exception's
        // own doc comment for why this is a 500, not a 400.
        throw new UnsupportedFulfillmentTypeException(
          order.id,
          giftTemplate.delivery_type,
        );
    }
  }

  private async fulfilDigitalVoucher(order: OrderRow): Promise<void> {
    await this.ordersService.transitionNormal(
      order.id,
      OrderStatus.Processing,
      OrderStatus.FulfillmentInProgress,
      { type: 'system' },
    );

    await this.fulfillments.create({
      orderId: order.id,
      fulfillmentType: FulfillmentType.DigitalVoucher,
      status: FulfillmentStatus.InProgress,
    });

    const voucherCode = this.digitalVoucher.generateCode();

    // voucher_valid_until mirrors orders.expires_at — INFERRED, not
    // schema-mandated: expire_unclaimed_gifts() is what actually enforces
    // expiry, and it keys off orders.expires_at directly, never this
    // column. voucher_valid_until is display-only ("valid until X" copy
    // for the recipient) with no business rule of its own specified
    // anywhere seen so far, so mirroring the order's own expiry is the
    // most conservative choice available rather than inventing a
    // separate validity window. Flagging, not silently deciding.
    await this.fulfillments.markVoucherIssued(order.id, {
      voucherCode,
      voucherValidUntil: order.expires_at,
    });

    await this.ordersService.transitionNormal(
      order.id,
      OrderStatus.FulfillmentInProgress,
      OrderStatus.VoucherIssued,
      { type: 'system' },
    );

    this.logger.log(`Order ${order.id}: digital voucher issued`);

    await this.notifyRecipient(order);
  }

  private async fulfilVtu(order: OrderRow): Promise<void> {
    await this.ordersService.transitionNormal(
      order.id,
      OrderStatus.Processing,
      OrderStatus.FulfillmentInProgress,
      { type: 'system' },
    );

    // Generated and persisted BEFORE calling the provider — the schema's
    // own instruction on gift_fulfillments.vtu_request_id: "enables
    // idempotency with VTU APIs — always set before calling provider,
    // check if set before retrying." The "check if set before retrying"
    // half is NOT implemented here — see this file's header and
    // GiftFulfillmentsRepository's doc comment for why a real
    // retry/resume path is deliberately out of scope for this slice.
    const requestId = randomUUID();

    await this.fulfillments.create({
      orderId: order.id,
      fulfillmentType: FulfillmentType.Vtu,
      status: FulfillmentStatus.Pending,
      vtuRequestId: requestId,
      vtuPhoneNumber: order.recipient_phone,
    });

    await this.fulfillments.markVtuProcessing(order.id);

    // No try/catch around this call: UnimplementedVtuProviderService
    // throws today, and letting that propagate is deliberate — see this
    // file's header on the failure mode. A real provider implementation
    // will need actual failure handling here (network errors, provider
    // declines mapped to FulfillmentStatus.Failed /
    // OrderStatus.FulfillmentFailed), added when there's a real provider
    // to observe real failure modes from — not guessed at now.
    const result = await this.vtuProvider.topUp({
      requestId,
      phoneNumber: order.recipient_phone,
      amountKobo: order.gift_value,
    });

    await this.fulfillments.markVtuComplete(order.id, {
      providerTransactionId: result.providerTransactionId,
    });

    await this.ordersService.transitionNormal(
      order.id,
      OrderStatus.FulfillmentInProgress,
      OrderStatus.ReadyForRedemption,
      { type: 'system' },
    );

    this.logger.log(`Order ${order.id}: VTU top-up complete`);

    await this.notifyRecipient(order);
  }

  /**
   * Called only after the order has ALREADY reached a terminal
   * fulfilled-and-ready state — the gift itself is genuinely ready by
   * this point. Wrapped separately from the fulfillment logic above so
   * a notification problem can never be mistaken for a fulfillment
   * problem: NotificationsService.sendGiftRevealLink already catches
   * and records its own expected failure mode (the outbound Termii
   * call itself failing), but this defends against anything else
   * unexpected from that service too — the invariant "reaching
   * voucher_issued/ready_for_redemption always succeeds even if
   * notifying the recipient doesn't" holds regardless.
   */
  private async notifyRecipient(order: OrderRow): Promise<void> {
    try {
      await this.notifications.sendGiftRevealLink(order);
    } catch (err) {
      this.logger.error(
        `Order ${order.id}: unexpected error sending the gift reveal notification (order fulfillment itself succeeded).`,
        err instanceof Error ? err.stack : err,
      );
    }
  }
}
