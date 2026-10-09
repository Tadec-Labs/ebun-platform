import { Injectable, Logger, NotFoundException } from '@nestjs/common';
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
 * Only public surface of RedemptionsModule — RedemptionsRepository
 * stays internal, same boundary as every other module here.
 */
@Injectable()
export class RedemptionsService {
  private readonly logger = new Logger(RedemptionsService.name);

  constructor(
    private readonly repository: RedemptionsRepository,
    private readonly ordersService: OrdersService,
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
  async lookupByFallbackCode(code: string): Promise<RedemptionLookupView> {
    const row = await this.repository.findByFallbackCode(code);
    if (!row) {
      throw new NotFoundException('No gift found for that code.');
    }

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
    ipAddress: string | null;
    userAgent: string | null;
  }): Promise<{ redemption: RedemptionRow; orderId: string }> {
    const row = await this.repository.findByFallbackCode(params.code);
    if (!row) {
      throw new NotFoundException('No gift found for that code.');
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
      actorType: 'admin',
    });

    return { redemption, orderId: row.order_id };
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

    try {
      await this.ordersService.transitionNormal(
        redemption.order_id,
        OrderStatus.RevealOpened,
        OrderStatus.Redeemed,
        { type: params.actorType },
      );
    } catch (err) {
      this.logger.error(
        `Redemption ${redemption.id} (order ${redemption.order_id}) completed successfully, ` +
          `but the order's own status transition to 'redeemed' failed — order status will ` +
          `lag behind the real (correctly single-use-enforced) redemption state until reconciled.`,
        err instanceof Error ? err.stack : err,
      );
    }

    return redemption;
  }
}
