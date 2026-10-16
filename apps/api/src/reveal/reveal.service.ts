import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { FulfillmentType, OrderStatus, RedemptionStatus } from '@ebun/types';
import { OrdersService } from '../orders/orders.service';
import { OrderRow } from '../orders/orders.repository';
import { GiftsService } from '../gifts/gifts.service';
import { UsersService } from '../users/users.service';
import { RedemptionsService } from '../redemptions/redemptions.service';
import { VendorsService } from '../vendors/vendors.service';
import { MEDIA_URL_RESOLVER } from '../media/media-url-resolver.interface';
import type { MediaUrlResolver } from '../media/media-url-resolver.interface';
import { OrderTransitionConflictException } from '../orders/exceptions/order-transition-conflict.exception';
import { RevealView } from './reveal-view.interface';
import { DeliveriesService } from '../deliveries/deliveries.service';
import { VendorAlertsService } from '../alerts/vendor-alerts.service';
import type { DeliveryDetailsInput } from '../deliveries/deliveries.service';
import { CampaignGiftsService } from '../corporate/campaign-gifts.service';

const PRE_REVEAL_STATES = new Set([
  OrderStatus.VoucherIssued,
  OrderStatus.ReadyForRedemption,
]);

const VIEWABLE_AFTER_REVEAL_STATES = new Set([
  OrderStatus.RevealOpened,
  OrderStatus.Redeemed,
  OrderStatus.Fulfilled,
]);

/**
 * A doorstep gift is viewable from the moment it's paid for: the
 * recipient opens it, then says where to bring it. These are the states
 * it sits in while that happens — for any other fulfillment type they
 * mean "not ready yet".
 */
const PHYSICAL_IN_FLIGHT_STATES = new Set([
  OrderStatus.FulfillmentInProgress,
  OrderStatus.Dispatched,
  OrderStatus.Delivered,
]);

/** The sender's message on a delivered gift opens with the gift, not before. */
const PHYSICAL_MESSAGE_RELEASED_STATES = new Set([
  OrderStatus.Delivered,
  OrderStatus.Fulfilled,
]);

const TERMINAL_NEGATIVE_STATES = new Set([
  OrderStatus.Expired,
  OrderStatus.Cancelled,
  OrderStatus.Refunded,
  OrderStatus.FulfillmentFailed,
  OrderStatus.RedemptionFailed,
]);

/** How far ahead a collection can be booked. */
const MAX_BOOKING_AHEAD_MS = 7 * 24 * 60 * 60_000;

/**
 * Only public surface of RevealModule.
 *
 * PROVISIONAL BY DESIGN: built ahead of real mockups (Figma incoming),
 * at the person's explicit request to do backend first. The viewState
 * bucketing in reveal-view.interface.ts is my best guess at what a
 * reveal page needs to distinguish, not a locked contract — expect to
 * revise this once real screens exist. fulfillmentType and redemption
 * were added to close two specific gaps apps/web's reveal screen hit
 * while building against this contract; see reveal-view.interface.ts.
 */
@Injectable()
export class RevealService {
  private readonly logger = new Logger(RevealService.name);

  constructor(
    private readonly ordersService: OrdersService,
    private readonly giftsService: GiftsService,
    private readonly usersService: UsersService,
    private readonly redemptions: RedemptionsService,
    private readonly vendors: VendorsService,
    private readonly audit: AuditService,
    private readonly deliveries: DeliveriesService,
    private readonly alerts: VendorAlertsService,
    private readonly campaignGifts: CampaignGiftsService,
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

    // Doorstep gifts are open to view as soon as they're paid for, and
    // don't expire on this screen: the recipient may take a few days to
    // give an address, and a paid hamper must never show "expired" to
    // the person it's for. (A digital gift sitting in these same states
    // is mid-fulfilment and falls through to not_ready below.)
    if (PHYSICAL_IN_FLIGHT_STATES.has(order.status)) {
      const template = await this.giftsService.findById(order.gift_template_id);
      if (template.delivery_type === FulfillmentType.Physical) {
        return this.buildView(order, 'ready');
      }
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

    // A company gift with options, not picked yet.
    if (
      order.campaign_id &&
      order.status === OrderStatus.Paid &&
      !order.gift_chosen_at
    ) {
      return this.buildChooseView(order);
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

    // A delivered doorstep gift: "accepting" is unwrapping the message
    // that arrived with it, which completes the gift.
    if (order.status === OrderStatus.Delivered) {
      const template = await this.giftsService.findById(order.gift_template_id);
      if (template.delivery_type === FulfillmentType.Physical) {
        await this.deliveries.markOpened(order.id);
      }
      return this.view(revealToken);
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
    // view() call below now returns the fallback code + QR payload
    // (see buildView) alongside confirming acceptance succeeded.
    return this.view(revealToken);
  }

  /**
   * POST /reveal/:token/pickup. The recipient says where and when
   * they'll collect, so the vendor can have it ready — the difference
   * between a pizza waiting at the counter and a 30-minute wait in front
   * of it.
   *
   * Only for a claimed collection voucher that can still be collected.
   * Re-booking is allowed (plans change) and clears the vendor's
   * confirmation, since they agreed to a different time.
   */
  async bookPickup(
    revealToken: string,
    vendorId: string,
    pickupAtIso: string,
  ): Promise<RevealView> {
    const order = await this.ordersService.findByRevealToken(revealToken);
    if (!order) {
      throw new NotFoundException('No gift found for this link.');
    }

    const giftTemplate = await this.giftsService.findById(
      order.gift_template_id,
    );
    const redemption =
      giftTemplate.delivery_type === FulfillmentType.DigitalVoucher &&
      order.status === OrderStatus.RevealOpened
        ? await this.redemptions.findByOrderId(order.id)
        : null;
    if (
      !redemption ||
      redemption.status === RedemptionStatus.Completed ||
      redemption.status === RedemptionStatus.Failed ||
      redemption.status === RedemptionStatus.Expired
    ) {
      throw new BadRequestException(
        "This gift can't be booked for collection right now.",
      );
    }

    const pickupAt = new Date(pickupAtIso);
    const now = Date.now();
    // A few minutes' grace for a phone clock that runs slow; anything
    // earlier is a time that has already passed.
    const earliest = now - 5 * 60_000;
    const latest = Math.min(
      new Date(redemption.expires_at as string).getTime(),
      new Date(order.expires_at).getTime(),
      now + MAX_BOOKING_AHEAD_MS,
    );
    if (
      Number.isNaN(pickupAt.getTime()) ||
      pickupAt.getTime() < earliest ||
      pickupAt.getTime() > latest
    ) {
      throw new BadRequestException(
        'Choose a time from now until your gift expires (at most a week ahead).',
      );
    }

    // Strict here, unlike the view: booking somewhere that can't take
    // the code is worse than an error the recipient can retry.
    const places = await this.vendors.collectionPointsForGift(
      order.gift_template_id,
    );
    if (!places.some((place) => place.vendorId === vendorId)) {
      throw new BadRequestException(
        "That place can't hand over this gift. Choose one from the list.",
      );
    }

    const booked = await this.ordersService.recordPickup(
      order.id,
      vendorId,
      pickupAt.toISOString(),
    );
    if (!booked) {
      throw new ConflictException(
        'This gift has changed since you opened it. Reload the page.',
      );
    }

    await this.audit.record({
      eventType: 'order.pickup_booked',
      actorId: null,
      actorType: 'user',
      resourceType: 'order',
      resourceId: order.id,
      metadata: { vendorId, pickupAt: pickupAt.toISOString() },
    });

    // Email as well as the vendor's "Coming in" list — the list only
    // helps if someone is looking at it. Never throws.
    await this.alerts.newPickup(order.id, vendorId, pickupAt.toISOString());

    return this.view(revealToken);
  }

  /**
   * POST /reveal/:token/delivery. Where to bring a doorstep gift — and
   * the moment a vendor is assigned to it. Can be repeated to correct the
   * address until a rider has it.
   */
  async setDelivery(
    revealToken: string,
    details: DeliveryDetailsInput,
  ): Promise<RevealView> {
    const order = await this.ordersService.findByRevealToken(revealToken);
    if (!order) {
      throw new NotFoundException('No gift found for this link.');
    }
    await this.deliveries.setRecipientDetails(order.id, details);
    return this.view(revealToken);
  }

  /** A company gift with options: the recipient picks one, and it's fulfilled on the spot. */
  async chooseGift(
    revealToken: string,
    giftTemplateId: string,
  ): Promise<RevealView> {
    const order = await this.ordersService.findByRevealToken(revealToken);
    if (!order) {
      throw new NotFoundException('No gift found for this link.');
    }
    if (new Date(order.expires_at) <= new Date()) {
      return this.buildView(order, 'expired');
    }
    await this.campaignGifts.choose(order, giftTemplateId);
    return this.view(revealToken);
  }

  /** A thank-you note back to the company that sent the gift. */
  async thank(revealToken: string, note: string): Promise<RevealView> {
    const order = await this.ordersService.findByRevealToken(revealToken);
    if (!order) {
      throw new NotFoundException('No gift found for this link.');
    }
    await this.campaignGifts.thank(order, note);
    return this.view(revealToken);
  }

  private async buildChooseView(order: OrderRow): Promise<RevealView> {
    const info = await this.campaignGifts.revealInfo(order);
    if (!info?.choices || info.choices.length === 0) {
      return { viewState: 'not_ready', orderStatus: order.status };
    }
    return {
      viewState: 'choose',
      orderStatus: order.status,
      recipientName: order.recipient_name,
      senderName: info.senderDisplayName ?? info.companyName,
      theme: order.reveal_theme,
      company: {
        companyName: info.companyName,
        title: info.title,
        thanked: info.thanked,
        choices: info.choices,
      },
    };
  }

  /** The recipient confirms their doorstep gift arrived — completes it and credits the vendor. */
  async confirmReceived(revealToken: string): Promise<RevealView> {
    const order = await this.ordersService.findByRevealToken(revealToken);
    if (!order) {
      throw new NotFoundException('No gift found for this link.');
    }
    await this.deliveries.markDelivered({ kind: 'recipient' }, order.id);
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

    const company = order.campaign_id
      ? await this.campaignGifts.revealInfo(order)
      : null;

    const view: RevealView = {
      viewState,
      orderStatus: order.status,
      fulfillmentType: giftTemplate.delivery_type,
      recipientName: order.recipient_name,
      senderName: company
        ? (company.senderDisplayName ?? company.companyName)
        : (sender?.name ?? null),
      giftName: giftTemplate.name,
      giftDescription: giftTemplate.description,
      giftImageUrl: giftTemplate.image_url,
      bookingStyle: giftTemplate.booking_style ?? 'pickup',
      theme: order.reveal_theme,
    };
    if (company) {
      view.company = {
        companyName: company.companyName,
        title: company.title,
        thanked: company.thanked,
      };
    }

    const isPhysical = giftTemplate.delivery_type === FulfillmentType.Physical;
    if (isPhysical) {
      view.delivery =
        (await this.deliveries.forRecipient(order.id, order.status)) ??
        undefined;
    }

    // A doorstep gift's message is withheld until it has been delivered —
    // server-side, so the "opens when it arrives" lock is real and not
    // just a screen that hides what the page already downloaded.
    const messageReleased =
      !isPhysical || PHYSICAL_MESSAGE_RELEASED_STATES.has(order.status);

    if (!messageReleased) {
      view.messageLocked = order.message_type !== null;
    } else if (order.message_type === 'text') {
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
          ? ((await this.mediaResolver.resolvePlaybackUrl(order.message_url)) ??
            undefined)
          : undefined,
      };
    }

    // Only digital_voucher has a vendor-scan step worth showing a
    // code/QR for — vtu auto-completes with nothing left to show, and
    // physical doesn't use the redemptions table at all. Completed
    // redemptions are left out too: that's the terminal "redeemed"
    // state, not "here's your code", and the order's own status
    // already carries that.
    if (
      giftTemplate.delivery_type === FulfillmentType.DigitalVoucher &&
      order.status === OrderStatus.RevealOpened
    ) {
      const existingRedemption = await this.redemptions.findByOrderId(order.id);
      if (
        existingRedemption &&
        existingRedemption.status !== RedemptionStatus.Completed
      ) {
        view.redemption = {
          status: existingRedemption.status,
          fallbackCode: existingRedemption.fallback_code,
          // The QR carries the same short code printed beneath it, not
          // the redemption_token. The only thing that reads this QR is
          // the vendor counter's camera, which looks codes up exactly as
          // if they were typed — vendor-scoped and rate-limited. Putting
          // the long token on screen bought nothing (no scanner ever used
          // it) and exposed the one value that redeems a gift without a
          // vendor session via the public POST /redeem.
          qrPayload: existingRedemption.fallback_code,
          expiresAt: existingRedemption.expires_at as string,
        };
        view.collectAt = await this.collectionPoints(order.gift_template_id);
        if (order.pickup_vendor_id && order.pickup_at) {
          const place = view.collectAt.find(
            (point) => point.vendorId === order.pickup_vendor_id,
          );
          view.pickup = {
            vendorId: order.pickup_vendor_id,
            placeName: place?.name ?? null,
            whatsapp: place?.whatsapp ?? null,
            at: order.pickup_at,
            confirmed: Boolean(order.pickup_confirmed_at),
          };
        }
      }
    }

    if (
      giftTemplate.delivery_type === FulfillmentType.DigitalVoucher &&
      (order.status === OrderStatus.Redeemed ||
        order.status === OrderStatus.Fulfilled)
    ) {
      view.collected = await this.collectedDetails(order.id);
    }

    return view;
  }

  /**
   * Where and when a collected gift was handed over, for the "enjoy it"
   * screen. Same rule as collectionPoints: a lookup failure loses the
   * detail, never the page.
   */
  private async collectedDetails(
    orderId: string,
  ): Promise<NonNullable<RevealView['collected']>> {
    try {
      const redemption = await this.redemptions.findByOrderId(orderId);
      if (!redemption || redemption.status !== RedemptionStatus.Completed) {
        return { at: null, placeName: null };
      }
      const vendorId =
        typeof redemption.vendor_id === 'string' ? redemption.vendor_id : null;
      const at =
        typeof redemption.completed_at === 'string'
          ? redemption.completed_at
          : null;
      return {
        at,
        placeName: vendorId ? await this.vendors.publicNameOf(vendorId) : null,
      };
    } catch (err) {
      this.logger.warn(
        `Collected-details lookup failed for order ${orderId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return { at: null, placeName: null };
    }
  }

  /**
   * Never allowed to take the voucher down with it. The code and QR are
   * the gift; the list of places is help finding where to use it. If the
   * lookup fails, the recipient still gets their code (and the screen's
   * no-locations wording), and the failure is logged for us rather than
   * shown to them as an error page.
   */
  private async collectionPoints(
    giftTemplateId: string,
  ): Promise<NonNullable<RevealView['collectAt']>> {
    try {
      return await this.vendors.collectionPointsForGift(giftTemplateId);
    } catch (err) {
      this.logger.warn(
        `Collection points lookup failed for gift template ${giftTemplateId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return [];
    }
  }
}
