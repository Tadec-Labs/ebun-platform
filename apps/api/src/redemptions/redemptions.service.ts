import { Injectable, Logger } from '@nestjs/common';
import { OrderStatus } from '@ebun/types';
import { OrdersService } from '../orders/orders.service';
import { RedemptionsRepository, RedemptionRow } from './redemptions.repository';
import { RedemptionConflictException } from './exceptions/redemption-conflict.exception';

export interface CompleteRedemptionParams {
  redemptionToken: string;
  vendorId: string | null;
  vendorConfirmedBy: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  /** Who's completing this — 'vendor' for a real in-person scan, 'system' for a no-vendor-needed type (VTU) auto-completing right after accept. */
  actorType: 'vendor' | 'system';
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
