import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { FulfillmentType, OrderStatus } from '@ebun/types';
import { OrdersService } from '../orders/orders.service';
import { OrderRow } from '../orders/orders.repository';
import { GiftsService } from '../gifts/gifts.service';
import { UsersService } from '../users/users.service';
import { RedemptionsService } from '../redemptions/redemptions.service';
import { MEDIA_URL_RESOLVER } from '../media/media-url-resolver.interface';
import type { MediaUrlResolver } from '../media/media-url-resolver.interface';
import { OrderTransitionConflictException } from '../orders/exceptions/order-transition-conflict.exception';
import { RevealView } from './reveal-view.interface';

const PRE_REVEAL_STATES = new Set([
  OrderStatus.VoucherIssued,
  OrderStatus.ReadyForRedemption,
]);

const VIEWABLE_AFTER_REVEAL_STATES = new Set([
  OrderStatus.RevealOpened,
  OrderStatus.Redeemed,
  OrderStatus.Fulfilled,
]);

const TERMINAL_NEGATIVE_STATES = new Set([
  OrderStatus.Expired,
  OrderStatus.Cancelled,
  OrderStatus.Refunded,
  OrderStatus.FulfillmentFailed,
  OrderStatus.RedemptionFailed,
]);

/**
 * Only public surface of RevealModule.
 *
 * PROVISIONAL BY DESIGN: built ahead of real mockups (Figma incoming),
 * at the person's explicit request to do backend first. The viewState
 * bucketing in reveal-view.interface.ts is my best guess at what a
 * reveal page needs to distinguish, not a locked contract — expect to
 * revise this once real screens exist.
 */
@Injectable()
export class RevealService {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly giftsService: GiftsService,
    private readonly usersService: UsersService,
    private readonly redemptions: RedemptionsService,
    @Inject(MEDIA_URL_RESOLVER)
    private readonly mediaResolver: MediaUrlResolver,
  ) {}

  /**
   * GET /reveal/:token. Safe to call repeatedly — the first call in a
   * viewable pre-reveal state transitions the order to reveal_opened;
   * every call after that (by design, or because a concurrent request
   * won the race — see the catch below) just serves the same content.
   */
  async view(revealToken: string): Promise<RevealView> {
    const order = await this.ordersService.findByRevealToken(revealToken);
    if (!order) {
      throw new NotFoundException('No gift found for this link.');
    }

    // Checked directly against expires_at, NOT trusted from order.status
    // alone — no cron runs expire_unclaimed_gifts() yet (see
    // FulfillmentOrchestratorService's file header for the established
    // pattern of flagging cron-shaped gaps rather than silently
    // assuming status is current). An order can be genuinely past its
    // window while still sitting at ready_for_redemption/voucher_issued
    // because nothing has swept it yet.
    const isPastExpiry = new Date(order.expires_at) <= new Date();

    if (
      isPastExpiry &&
      order.status !== OrderStatus.Redeemed &&
      order.status !== OrderStatus.Fulfilled
    ) {
      return this.buildView(order, 'expired');
    }

    if (TERMINAL_NEGATIVE_STATES.has(order.status)) {
      return this.buildView(order, 'unavailable');
    }

    if (PRE_REVEAL_STATES.has(order.status)) {
      try {
        await this.ordersService.transitionNormal(
          order.id,
          order.status,
          OrderStatus.RevealOpened,
          { type: 'user' },
        );
        order.status = OrderStatus.RevealOpened;
      } catch (err) {
        // A concurrent request (e.g. WhatsApp link preview fetchers
        // hitting it at the same moment as the actual recipient) may
        // have already won this exact transition. That's not a failure
        // from this caller's point of view — the content is still
        // safe to serve as "opened". Anything else is a genuine,
        // unexpected problem and should propagate.
        if (!(err instanceof OrderTransitionConflictException)) {
          throw err;
        }
        order.status = OrderStatus.RevealOpened;
      }
      return this.buildView(order, 'ready');
    }

    if (VIEWABLE_AFTER_REVEAL_STATES.has(order.status)) {
      return this.buildView(order, 'ready');
    }

    // paid / processing / fulfillment_in_progress / etc — the token
    // exists (generated at order creation) but the gift genuinely isn't
    // ready. Shouldn't happen in normal use (NotificationsService only
    // sends this link once fulfillment completes), but the token could
    // be probed before then.
    return this.buildView(order, 'not_ready');
  }

  /**
   * POST /reveal/:token/accept. Implicitly performs the reveal
   * transition too if it hasn't happened yet (an accept without a prior
   * GET is still a real acceptance, not an error). Creates the pending
   * redemption record and, for fulfillment types with no vendor step to
   * wait for (vtu — the money already landed as a top-up at fulfillment
   * time), completes it immediately rather than leaving the recipient
   * waiting on a redemption record that nothing else will ever advance.
   */
  async acceptGift(revealToken: string): Promise<RevealView> {
    const order = await this.ordersService.findByRevealToken(revealToken);
    if (!order) {
      throw new NotFoundException('No gift found for this link.');
    }

    if (PRE_REVEAL_STATES.has(order.status)) {
      await this.view(revealToken); // reuses the same idempotent transition + race handling
      order.status = OrderStatus.RevealOpened;
    }

    if (order.status !== OrderStatus.RevealOpened) {
      // Already redeemed/fulfilled, or expired/cancelled/etc — nothing
      // new to do. Return the current view rather than erroring; an
      // "accept" on a gift that's already accepted isn't a client
      // mistake worth a 4xx.
      return this.view(revealToken);
    }

    const giftTemplate = await this.giftsService.findById(
      order.gift_template_id,
    );

    const redemption = await this.redemptions.createPendingForOrder(
      order.id,
      order.expires_at,
    );

    if (giftTemplate.delivery_type === FulfillmentType.Vtu) {
      await this.redemptions.complete({
        redemptionToken: redemption.redemption_token,
        vendorId: null,
        vendorConfirmedBy: null,
        ipAddress: null,
        userAgent: null,
        actorType: 'system',
      });
      return this.view(revealToken);
    }

    // digital_voucher — pending, waiting on a real vendor scan via
    // POST /redeem (not built into any vendor-facing UI yet). The
    // recipient's own view of "I've accepted, here's my code" is
    // reveal-view.interface.ts's job to render once real mockups exist;
    // for now this just confirms acceptance succeeded.
    return this.view(revealToken);
  }

  private async buildView(
    order: OrderRow,
    viewState: RevealView['viewState'],
  ): Promise<RevealView> {
    if (
      viewState === 'not_ready' ||
      viewState === 'expired' ||
      viewState === 'unavailable'
    ) {
      // Deliberately minimal — no gift/sender details for a link that
      // isn't (or is no longer) valid to view.
      return { viewState, orderStatus: order.status };
    }

    const giftTemplate = await this.giftsService.findById(
      order.gift_template_id,
    );
    const sender = order.sender_id
      ? await this.usersService.findById(order.sender_id)
      : null;

    const view: RevealView = {
      viewState,
      orderStatus: order.status,
      recipientName: order.recipient_name,
      senderName: sender?.name ?? null,
      giftName: giftTemplate.name,
      giftDescription: giftTemplate.description,
      giftImageUrl: giftTemplate.image_url,
      theme: order.reveal_theme,
    };

    if (order.message_type === 'text') {
      view.message = { type: 'text', text: order.sender_message };
    } else if (
      order.message_type === 'voice' ||
      order.message_type === 'video'
    ) {
      view.message = {
        type: order.message_type,
        text: order.sender_message, // optional caption alongside voice/video, if the sender added one
        durationSecs: order.message_duration_secs,
        playbackUrl: order.message_url
          ? await this.mediaResolver.resolvePlaybackUrl(order.message_url)
          : undefined,
      };
    }

    return view;
  }
}
