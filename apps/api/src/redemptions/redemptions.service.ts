import { AutoPayoutsService } from '../payouts/auto-payouts.service';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, RedemptionStatus } from '@ebun/types';
import { OrdersService } from '../orders/orders.service';
import {
  RedemptionLookupRow,
  RedemptionsRepository,
  RedemptionRow,
} from './redemptions.repository';
import { RedemptionConflictException } from './exceptions/redemption-conflict.exception';
import { RedemptionNotRedeemableException } from './exceptions/redemption-not-redeemable.exception';

export interface CompleteRedemptionParams {
  redemptionToken: string;
  vendorId: string | null;
  vendorConfirmedBy: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  /**
   * Who's completing this — 'vendor' for a real in-person scan,
   * 'system' for a no-vendor-needed type (VTU) auto-completing right
   * after accept, 'admin' for an Ebun staff member confirming on a
   * vendor's behalf from /ops. The third exists because until a
   * vendor-facing scanner is built, every real collection is a staff
   * member typing the code the recipient reads out — recording that as
   * 'vendor' would put a claim in the audit log that isn't true.
   */
  actorType: 'vendor' | 'system' | 'admin';
}

/**
 * What ops is allowed to see about a code before confirming it.
 * Deliberately does NOT carry redemption_token: possessing that token
 * is what completes a redemption, and a lookup — which any staff member
 * can run against any code — must not hand it out. The complete call
 * re-reads the token server-side from the same code instead.
 */
export interface RedemptionLookupView {
  code: string;
  redemptionNumber: string;
  status: RedemptionStatus;
  orderNumber: string | null;
  recipientName: string | null;
  giftName: string | null;
  expiresAt: string;
  completedAt: string | null;
  /** True only when a confirm would actually succeed right now. */
  redeemable: boolean;
  /** Plain-language reason it can't be collected, when redeemable is false. */
  blockedReason: string | null;
}

/**
 * The staff view adds who may be credited with handing it over. Never
 * returned to the vendor counter: one vendor has no business seeing
 * which other businesses sell the same gift.
 */
export interface OpsRedemptionLookupView extends RedemptionLookupView {
  /** Active vendors that offer this gift — the only valid choices. */
  eligibleVendors: { id: string; name: string }[];
}

/**
 * Only public surface of RedemptionsModule — RedemptionsRepository
 * stays internal, same boundary as every other module here.
 */
@Injectable()
export class RedemptionsService {
  private readonly logger = new Logger(RedemptionsService.name);

  constructor(
    private readonly repository: RedemptionsRepository,
    private readonly ordersService: OrdersService,
    private readonly autoPayouts: AutoPayoutsService,
  ) {}

  /** Read-only lookup for GET /reveal/:token — never creates anything, unlike createPendingForOrder. Null if no redemption exists yet for this order. */
  async findByOrderId(orderId: string): Promise<RedemptionRow | null> {
    return this.repository.findByOrderId(orderId);
  }

  /** Called from POST /reveal/:token/accept — creates (or returns the existing) pending redemption row for an order. Idempotent on purpose; see RedemptionsRepository's doc comment. */
  async createPendingForOrder(
    orderId: string,
    orderExpiresAt: string,
  ): Promise<RedemptionRow> {
    return this.repository.createPendingOrFetch(orderId, orderExpiresAt);
  }

  /** Called by the daily expiry sweep. Returns the ids it expired. */
  async expireOverdue(): Promise<string[]> {
    return this.repository.expireOverdue();
  }

  /**
   * Looks a code up for ops, without changing anything.
   *
   * `redeemable` is computed here rather than left to the caller so
   * every surface agrees on what "can be collected" means, and so the
   * reason is phrased for the person at the counter rather than
   * leaking status enums into the UI.
   */
  async lookupByFallbackCode(code: string): Promise<OpsRedemptionLookupView> {
    const row = await this.repository.findByFallbackCode(code);
    if (!row) {
      throw new NotFoundException('No gift found for that code.');
    }

    const giftTemplateId = row.orders?.gift_template_id;
    const eligibleVendors = giftTemplateId
      ? (await this.repository.listVendorsOfferingGift(giftTemplateId))
          .filter((vendor) => vendor.active)
          .map((vendor) => ({ id: vendor.id, name: vendor.business_name }))
          .sort((a, b) => a.name.localeCompare(b.name))
      : [];

    return { ...this.toLookupView(row), eligibleVendors };
  }

  private toLookupView(row: RedemptionLookupRow): RedemptionLookupView {
    const { redeemable, blockedReason } = this.assessRedeemability(row);

    return {
      code: row.fallback_code,
      redemptionNumber: row.redemption_number,
      status: row.status,
      orderNumber: row.orders?.order_number ?? null,
      recipientName: row.orders?.recipient_name ?? null,
      giftName: row.orders?.gift_templates?.name ?? null,
      expiresAt: row.expires_at,
      completedAt: row.completed_at,
      redeemable,
      blockedReason,
    };
  }

  /**
   * The vendor counter's view of a code.
   *
   * Identical to the ops lookup with one addition that matters: the
   * gift this code is for, so the caller can check the vendor actually
   * sells it before showing them anything. Without that check a leaked
   * link would let any vendor inspect every code in the system.
   */
  async lookupForVendor(
    code: string,
    sellsGift: (giftTemplateId: string) => Promise<boolean>,
  ): Promise<RedemptionLookupView> {
    const row = await this.repository.findByFallbackCode(code);
    if (!row) {
      throw new NotFoundException('No gift found for that code.');
    }

    const giftTemplateId = row.orders?.gift_template_id;
    if (!giftTemplateId || !(await sellsGift(giftTemplateId))) {
      // Deliberately the same 404 as an unknown code. Telling a vendor
      // "that code is real but not yours" confirms the code exists,
      // which is the one fact a guessed code should never reveal.
      throw new NotFoundException('No gift found for that code.');
    }

    return this.toLookupView(row);
  }

  /**
   * The ops counterpart of POST /redeem: same atomic
   * attempt_redemption() underneath, reached by the code a recipient
   * can read aloud instead of a token only a scanner could supply.
   *
   * Re-checks redeemability first so the common refusals (already
   * collected, expired, not yet claimed by the recipient) come back as
   * a specific, actionable message. attempt_redemption() would refuse
   * most of these too, but only as an undifferentiated null — and the
   * order-status check has no equivalent there at all: completing a
   * redemption whose order never reached reveal_opened would succeed
   * in the redemptions table while the order's own transition failed,
   * leaving the two permanently disagreeing (see complete() below).
   */
  async completeByFallbackCode(params: {
    code: string;
    vendorId: string;
    confirmedBy: string;
    actorId: string | null;
    actorType?: 'admin' | 'vendor';
    ipAddress: string | null;
    userAgent: string | null;
    /**
     * The vendor counter's own check, which answers a mismatch with the
     * same 404 as an unknown code so a guessed code reveals nothing.
     *
     * When absent (the staff path), the same rule is still enforced —
     * see requireVendorOffersGift. It used to be skipped for staff on
     * the theory that ops would choose knowingly; in practice the
     * dropdown listed every active vendor, and a collection was
     * credited to a vendor with no offering at all — a payout with no
     * agreed price behind it.
     */
    sellsGift?: (giftTemplateId: string) => Promise<boolean>;
  }): Promise<{ redemption: RedemptionRow; orderId: string }> {
    const row = await this.repository.findByFallbackCode(params.code);
    if (!row) {
      throw new NotFoundException('No gift found for that code.');
    }

    if (params.sellsGift) {
      const giftTemplateId = row.orders?.gift_template_id;
      if (!giftTemplateId || !(await params.sellsGift(giftTemplateId))) {
        throw new NotFoundException('No gift found for that code.');
      }
    } else {
      await this.requireVendorOffersGift(row, params.vendorId);
    }

    const { redeemable, blockedReason } = this.assessRedeemability(row);
    if (!redeemable) {
      throw new RedemptionNotRedeemableException(
        blockedReason ?? 'This gift cannot be collected.',
      );
    }

    const redemption = await this.complete({
      redemptionToken: row.redemption_token,
      vendorId: params.vendorId,
      vendorConfirmedBy: params.confirmedBy,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      actorType: params.actorType ?? 'admin',
    });

    return { redemption, orderId: row.order_id };
  }

  /**
   * Staff-path enforcement of "only a vendor that sells this gift can be
   * credited with handing it over". Unlike the counter, staff are told
   * plainly what's wrong — they are authorised to know which vendors
   * sell what, and a vague 404 would only send them hunting.
   */
  private async requireVendorOffersGift(
    row: RedemptionLookupRow,
    vendorId: string,
  ): Promise<void> {
    const giftTemplateId = row.orders?.gift_template_id;
    const vendors = giftTemplateId
      ? await this.repository.listVendorsOfferingGift(giftTemplateId)
      : [];
    const vendor = vendors.find((candidate) => candidate.id === vendorId);
    if (!vendor || !vendor.active) {
      const gift = row.orders?.gift_templates?.name ?? 'this gift';
      throw new BadRequestException(
        `That vendor isn't set up to hand over ${gift}. Add it to their offerings first, or choose the vendor who sells it.`,
      );
    }
  }

  private assessRedeemability(row: RedemptionLookupRow): {
    redeemable: boolean;
    blockedReason: string | null;
  } {
    const blocked = (reason: string) => ({
      redeemable: false,
      blockedReason: reason,
    });

    if (row.status === RedemptionStatus.Completed) {
      return blocked('This gift has already been collected.');
    }
    if (
      row.status === RedemptionStatus.Failed ||
      row.status === RedemptionStatus.Expired
    ) {
      return blocked('This code is no longer valid.');
    }
    if (new Date(row.expires_at) <= new Date()) {
      // Checked against the timestamp, not trusted from status alone —
      // nothing sweeps redemptions to 'expired' on a schedule yet, so a
      // genuinely expired row can still read 'pending'. Same reasoning
      // as RevealService's own expiry check.
      return blocked('This code has expired.');
    }

    const orderStatus = row.orders?.status;
    if (orderStatus === undefined) {
      return blocked('This code is not linked to an order — contact support.');
    }
    if (orderStatus !== OrderStatus.RevealOpened) {
      return blocked(
        "The recipient hasn't opened and claimed this gift yet, so there's nothing to hand over.",
      );
    }

    return { redeemable: true, blockedReason: null };
  }

  /**
   * Completes a redemption. NOT atomic with the order's own status
   * transition below — attempt_redemption() only touches the
   * `redemptions` table, by the schema's own explicit design ("Separate
   * from orders by design"). The redemption itself (the actual
   * single-use, fraud-relevant control) completes first and is fully
   * safe the moment this RPC returns non-null; the order's status
   * transition to `redeemed` is bookkeeping on top of that, done best-
   * effort afterward. If it fails, the redemption is still correctly,
   * permanently completed — the order's status would just lag behind
   * reality until someone notices and reconciles it. Flagged as an
   * inherent gap given the schema's table separation, not something to
   * silently paper over.
   */
  async complete(params: CompleteRedemptionParams): Promise<RedemptionRow> {
    const redemption = await this.repository.attemptRedemption({
      redemptionToken: params.redemptionToken,
      vendorId: params.vendorId,
      vendorConfirmedBy: params.vendorConfirmedBy,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    });

    if (!redemption) {
      throw new RedemptionConflictException();
    }

    const vendorPayoutAmount = params.vendorId
      ? await this.lookUpVendorPayout(redemption.order_id, params.vendorId)
      : null;

    try {
      // The vendor and what they are owed ride on the transition's audit
      // event, so the money trail is in audit_events even if the
      // columns below fail to write.
      const credit =
        params.vendorId && vendorPayoutAmount !== null
          ? { vendorId: params.vendorId, vendorPayoutAmount }
          : null;
      await this.ordersService.transitionNormal(
        redemption.order_id,
        OrderStatus.RevealOpened,
        OrderStatus.Redeemed,
        { type: params.actorType },
        credit ?? undefined,
      );
    } catch (err) {
      this.logger.error(
        `Redemption ${redemption.id} (order ${redemption.order_id}) completed successfully, ` +
          `but the order's own status transition to 'redeemed' failed — order status will ` +
          `lag behind the real (correctly single-use-enforced) redemption state until reconciled.`,
        err instanceof Error ? err.stack : err,
      );
    }

    if (params.vendorId && vendorPayoutAmount !== null) {
      try {
        await this.repository.recordVendorCredit(
          redemption.order_id,
          params.vendorId,
          vendorPayoutAmount,
        );
        // Handed over and credited: pay them now (no-op unless AUTO_PAYOUTS).
        this.autoPayouts.payVendorSoon(params.vendorId);
      } catch (err) {
        this.logger.error(
          `Redemption ${redemption.id} completed, but crediting vendor ${params.vendorId} ` +
            `with ${vendorPayoutAmount} kobo on order ${redemption.order_id} failed. ` +
            `The amount is on the order's 'redeemed' audit event; reconcile from there.`,
          err instanceof Error ? err.stack : err,
        );
      }
    }

    return redemption;
  }

  /**
   * Best-effort, like the order transition: the redemption has already
   * completed and must not be reported as failed because a price lookup
   * hiccupped. A miss is logged loudly, since it means a vendor handed
   * something over with no recorded amount owed.
   */
  private async lookUpVendorPayout(
    orderId: string,
    vendorId: string,
  ): Promise<number | null> {
    try {
      const amount = await this.repository.vendorPayoutFor(orderId, vendorId);
      if (amount === null) {
        this.logger.error(
          `Order ${orderId} was collected by vendor ${vendorId}, who has no offering for its gift — no payout amount recorded.`,
        );
      }
      return amount;
    } catch (err) {
      this.logger.error(
        `Couldn't read vendor ${vendorId}'s price for order ${orderId}; payout not recorded.`,
        err instanceof Error ? err.stack : err,
      );
      return null;
    }
  }
}
