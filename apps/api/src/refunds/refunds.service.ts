import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus } from '@ebun/types';
import { AuditService } from '../audit/audit.service';
import type { StaffContext } from '../auth/staff.guard';
import { OrderTransitionConflictException } from '../orders/exceptions/order-transition-conflict.exception';
import { OrdersService } from '../orders/orders.service';
import {
  PaystackClientService,
  PaystackRefundRejectedError,
} from '../paystack/paystack-client.service';
import {
  RefundReasonCategory,
  RefundRefusal,
  RefundRefusedError,
  RefundRow,
  RefundsRepository,
} from './refunds.repository';

export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * Paid for, and not handed over. A gift that was collected or delivered
 * has been paid out to a partner (or is about to be); refunding the
 * sender as well would pay twice. That is a dispute to settle by hand,
 * not a button.
 */
export const REFUNDABLE_STATUSES: OrderStatus[] = [
  OrderStatus.Paid,
  OrderStatus.Processing,
  OrderStatus.VendorNotified,
  OrderStatus.VendorAccepted,
  OrderStatus.VendorDeclined,
  OrderStatus.VendorTimeout,
  OrderStatus.FulfillmentInProgress,
  OrderStatus.Dispatched,
  OrderStatus.VoucherIssued,
  OrderStatus.ReadyForRedemption,
  OrderStatus.RevealOpened,
  OrderStatus.FulfillmentFailed,
  OrderStatus.RedemptionFailed,
  OrderStatus.Expired,
];

export interface RefundView {
  id: string;
  amount: number;
  reason: string;
  reasonCategory: RefundReasonCategory | null;
  /** pending → processing (Paystack has it) → completed; or failed. */
  status: RefundRow['status'];
  /** Paystack's word on a problem, e.g. it needs the customer's bank details. */
  problem: string | null;
  recordedManually: boolean;
  createdAt: string;
  processedAt: string | null;
}

export interface OrderRefundsView {
  refunds: RefundView[];
  /** Null when a refund can be started; otherwise why not, in ops' words. */
  cannotRefundBecause: string | null;
  /** kobo — what a refund returns: everything the sender paid. */
  refundAmount: number;
}

const REFUSAL_MESSAGE: Record<RefundRefusal, string> = {
  order_not_found: 'Order not found.',
  not_refundable_status:
    "This order can't be refunded from where it is now. Reload to see its current status.",
  vendor_credited:
    'A partner has already been credited for handing this over. Settle it with them first — this needs doing by hand.',
  already_collected:
    'This gift has already been collected, so it can no longer be refunded here.',
  already_refunding: 'A refund for this order is already under way.',
};

/**
 * Refunds started from /ops — the whole sender payment, back to the card
 * or account that paid.
 *
 * Order of events, and why:
 *   1. begin_order_refund (SQL, one lock): checks, voids the gift's open
 *      code, records the refund as pending. From here the recipient can't
 *      collect it while money is on its way back.
 *   2. Paystack refund request. Refused → the refund is marked failed and
 *      the code is given back, exactly as it was. Accepted → processing.
 *   3. The order moves to `refunded` (admin override, audited by
 *      attempt_order_transition).
 *   4. Paystack's refund.* webhooks move the refund to completed or
 *      failed. A failed one shows on /ops Today: the order is refunded on
 *      our side but the money hasn't gone back.
 *
 * "Already refunded in Paystack" skips step 2 for refunds made in the
 * dashboard before this existed (the early stuck orders).
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    private readonly repository: RefundsRepository,
    private readonly orders: OrdersService,
    private readonly paystack: PaystackClientService,
    private readonly audit: AuditService,
  ) {}

  async forOrder(orderId: string): Promise<OrderRefundsView> {
    const [order, refunds] = await Promise.all([
      this.repository.findOrder(orderId),
      this.repository.listForOrder(orderId),
    ]);
    if (!order) throw new NotFoundException('Order not found.');

    let cannotRefundBecause: string | null = null;
    if (refunds.some((refund) => refund.status !== 'failed')) {
      cannotRefundBecause =
        order.status === OrderStatus.Refunded
          ? 'Already refunded.'
          : REFUSAL_MESSAGE.already_refunding;
    } else if (order.vendor_payout_amount !== null) {
      cannotRefundBecause = REFUSAL_MESSAGE.vendor_credited;
    } else if (!REFUNDABLE_STATUSES.includes(order.status)) {
      cannotRefundBecause = notRefundableBecause(order.status);
    }

    return {
      refunds: refunds.map(toView),
      cannotRefundBecause,
      refundAmount: order.total_amount,
    };
  }

  async refund(
    orderId: string,
    input: {
      reasonCategory: RefundReasonCategory;
      reason: string;
      alreadyRefundedInPaystack: boolean;
    },
    staff: StaffContext,
    meta: RequestMeta,
  ): Promise<OrderRefundsView> {
    let begun: Awaited<ReturnType<RefundsRepository['begin']>>;
    try {
      begun = await this.repository.begin({
        orderId,
        refundableStatuses: REFUNDABLE_STATUSES,
        reason: input.reason,
        reasonCategory: input.reasonCategory,
        initiatedBy: staff.userId,
      });
    } catch (err) {
      if (err instanceof RefundRefusedError) {
        throw err.reason === 'order_not_found'
          ? new NotFoundException(REFUSAL_MESSAGE.order_not_found)
          : new ConflictException(REFUSAL_MESSAGE[err.reason]);
      }
      throw err;
    }

    if (input.alreadyRefundedInPaystack) {
      await this.repository.markRecordedManually(begun.refundId);
    } else {
      await this.sendToPaystack(orderId, begun);
    }

    await this.moveOrderToRefunded(orderId, begun, staff);

    await this.audit.record({
      eventType: 'refund.initiated',
      actorId: staff.userId,
      actorType: 'admin',
      resourceType: 'order',
      resourceId: orderId,
      newState: input.alreadyRefundedInPaystack ? 'completed' : 'processing',
      metadata: {
        refundId: begun.refundId,
        amount: begun.amount,
        reasonCategory: input.reasonCategory,
        reason: input.reason,
        recordedManually: input.alreadyRefundedInPaystack,
        codeVoided: begun.voidedRedemptionStatus !== null,
      },
      ...meta,
    });

    return this.forOrder(orderId);
  }

  /**
   * refund.processed / refund.failed / refund.needs-attention from
   * Paystack. Matched by the original transaction's reference to the one
   * refund still open for it. Unknown references are logged and ignored
   * — a refund made in the dashboard and never recorded here.
   */
  async applyPaystackRefundEvent(
    event: string,
    transactionReference: string | undefined,
  ): Promise<void> {
    if (!transactionReference) {
      this.logger.warn(`${event} without a transaction reference — ignored.`);
      return;
    }

    const now = new Date().toISOString();
    let row: RefundRow | null = null;
    switch (event) {
      case 'refund.processed':
        row = await this.repository.applyProgress(transactionReference, {
          status: 'completed',
          processed_at: now,
          failure_reason: null,
        });
        break;
      case 'refund.failed':
        row = await this.repository.applyProgress(transactionReference, {
          status: 'failed',
          failed_at: now,
          failure_reason:
            'Paystack could not complete the refund; the money went back to the SendEbun balance. Refund the sender another way.',
        });
        break;
      case 'refund.needs-attention':
        row = await this.repository.applyProgress(transactionReference, {
          failure_reason:
            "Paystack needs the sender's bank details to finish this refund. Complete it in the Paystack dashboard.",
        });
        break;
      default:
        // refund.pending / refund.processing: nothing new to record.
        return;
    }

    if (!row) {
      this.logger.warn(
        `${event} for ${transactionReference} matched no open refund — ignored.`,
      );
      return;
    }

    if (event !== 'refund.processed') {
      this.logger.error(
        `Refund ${row.id} for order ${row.order_id}: ${event}. Needs a person — see /ops.`,
      );
    }
    await this.audit.record({
      eventType: event,
      actorId: null,
      actorType: 'webhook',
      resourceType: 'order',
      resourceId: row.order_id,
      newState: row.status,
      metadata: { refundId: row.id },
      ipAddress: null,
      userAgent: null,
    });
  }

  private async sendToPaystack(
    orderId: string,
    begun: Awaited<ReturnType<RefundsRepository['begin']>>,
  ): Promise<void> {
    const giveUp = async (why: string) => {
      await this.repository.abandon(
        begun.refundId,
        why,
        begun.voidedRedemptionStatus,
      );
    };

    if (!begun.paystackReference) {
      await giveUp('No Paystack reference on the order.');
      throw new BadRequestException(
        "This order has no Paystack payment to refund. If the sender paid another way, refund them directly and tick 'already refunded'.",
      );
    }

    let paystackRefund: { id: string; status: string };
    try {
      paystackRefund = await this.paystack.createRefund({
        transactionReference: begun.paystackReference,
        amountKobo: begun.amount,
        customerNote: 'Refund from SendEbun',
        merchantNote: `SendEbun order ${orderId}`,
      });
    } catch (err) {
      const reason =
        err instanceof PaystackRefundRejectedError
          ? `Paystack: ${err.message}`
          : `Couldn't reach Paystack: ${err instanceof Error ? err.message : String(err)}`;
      await giveUp(reason);
      if (err instanceof PaystackRefundRejectedError) {
        throw new ConflictException(
          `Paystack refused the refund: ${err.message}. Nothing changed — the gift is as it was.`,
        );
      }
      throw new BadGatewayException(
        "Couldn't reach Paystack. Nothing changed — try again in a minute.",
      );
    }

    await this.repository.markSubmitted(begun.refundId, paystackRefund.id);
  }

  /**
   * The money is on its way back; now the order says so. Retried once
   * from the order's current status if something (the expiry job, say)
   * moved it between the SQL check and here. If that fails too, the
   * refund still stands — it's logged loudly and the order page shows
   * the refund — because undoing a refund Paystack already accepted
   * isn't possible.
   */
  private async moveOrderToRefunded(
    orderId: string,
    begun: Awaited<ReturnType<RefundsRepository['begin']>>,
    staff: StaffContext,
  ): Promise<void> {
    const metadata = { refundId: begun.refundId, amount: begun.amount };
    const actor = { type: 'admin' as const, id: staff.userId };
    try {
      await this.orders.transitionAdminOverride(
        orderId,
        begun.orderStatus,
        OrderStatus.Refunded,
        actor,
        metadata,
      );
      return;
    } catch (err) {
      if (!(err instanceof OrderTransitionConflictException)) {
        this.logger.error(
          `Refund ${begun.refundId} recorded but order ${orderId} not moved to refunded.`,
          err instanceof Error ? err.stack : err,
        );
        return;
      }
    }

    const current = await this.repository.findOrder(orderId);
    if (!current || current.status === OrderStatus.Refunded) return;
    try {
      await this.orders.transitionAdminOverride(
        orderId,
        current.status,
        OrderStatus.Refunded,
        actor,
        metadata,
      );
    } catch (err) {
      this.logger.error(
        `Refund ${begun.refundId} recorded but order ${orderId} (now ${current.status}) could not be moved to refunded — fix by hand.`,
        err instanceof Error ? err.stack : err,
      );
    }
  }
}

function toView(row: RefundRow): RefundView {
  return {
    id: row.id,
    amount: Number(row.amount),
    reason: row.reason,
    reasonCategory: row.reason_category,
    status: row.status,
    problem: row.failure_reason,
    recordedManually:
      row.notes?.startsWith('Refunded in the Paystack') ?? false,
    createdAt: row.created_at,
    processedAt: row.processed_at,
  };
}

function notRefundableBecause(status: OrderStatus): string {
  switch (status) {
    case OrderStatus.Draft:
    case OrderStatus.PendingPayment:
    case OrderStatus.PaymentFailed:
      return 'Nothing was paid, so there is nothing to refund.';
    case OrderStatus.Redeemed:
    case OrderStatus.Delivered:
    case OrderStatus.Fulfilled:
      return 'The gift has been handed over. A refund now would pay twice — settle it by hand.';
    case OrderStatus.Cancelled:
      return 'This order was cancelled.';
    case OrderStatus.Refunded:
      return 'Already refunded.';
    default:
      return "This order can't be refunded from where it is now.";
  }
}
