import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { StaffContext } from '../auth/staff.guard';
import { RecordPayoutDto } from './dto/vendor.dto';
import {
  CollectionRow,
  PayoutOrdersChangedError,
  PayoutRow,
  PayoutsRepository,
} from './payouts.repository';
import { VendorsRepository } from './vendors.repository';
import type { RequestMeta } from './vendors.service';

export interface CollectionView {
  orderId: string;
  orderNumber: string | null;
  giftName: string;
  /** kobo — what SendEbun owes the vendor for this one. */
  amount: number;
  collectedAt: string;
  paid: boolean;
  paidAt: string | null;
}

export interface PaymentView {
  id: string;
  /** kobo */
  amount: number;
  collections: number;
  paidAt: string | null;
  method: string | null;
  reference: string | null;
}

/**
 * What the vendor sees on their Earnings screen, and the base of what ops
 * sees. Deliberately no bank details and no recipient names.
 */
export interface EarningsView {
  /** kobo — collected but not yet paid. */
  owedNow: number;
  /** kobo — everything paid out so far. */
  paidTotal: number;
  collections: CollectionView[];
  payments: PaymentView[];
}

/** Ops also needs the exact collections to include when recording a payment. */
export interface OpsEarningsView extends EarningsView {
  unpaidOrderIds: string[];
}

/**
 * Enough to cover a vendor's whole history at pilot volume. If a vendor
 * ever has more collections than this, the oldest drop off the list —
 * the owed figure stays right as long as unpaid ones are recent, which
 * they are by construction (payouts clear the old ones).
 */
const COLLECTIONS_LIMIT = 500;
const PAYOUTS_LIMIT = 50;

@Injectable()
export class EarningsService {
  constructor(
    private readonly payouts: PayoutsRepository,
    private readonly vendors: VendorsRepository,
    private readonly audit: AuditService,
  ) {}

  async forVendor(vendorId: string): Promise<EarningsView> {
    // Built field by field so nothing ops-only rides along by accident.
    const { owedNow, paidTotal, collections, payments } =
      await this.build(vendorId);
    return { owedNow, paidTotal, collections, payments };
  }

  async forOps(vendorId: string): Promise<OpsEarningsView> {
    if (!(await this.vendors.findById(vendorId))) {
      throw new NotFoundException('Vendor not found');
    }
    return this.build(vendorId);
  }

  /**
   * Records a transfer ops has already made. Atomic in the database: all
   * listed collections are marked paid under one payout, or none are.
   */
  async recordPayout(
    vendorId: string,
    dto: RecordPayoutDto,
    staff: StaffContext,
    meta: RequestMeta,
  ): Promise<PaymentView> {
    if (!(await this.vendors.findById(vendorId))) {
      throw new NotFoundException('Vendor not found');
    }

    let payout: PayoutRow;
    try {
      payout = await this.payouts.recordPayout({
        vendorId,
        orderIds: [...new Set(dto.orderIds)],
        paymentRef: dto.paymentRef,
        paymentMethod: dto.paymentMethod ?? 'bank_transfer',
        notes: dto.notes ?? null,
        recordedBy: staff.userId,
      });
    } catch (err) {
      if (err instanceof PayoutOrdersChangedError) {
        throw new ConflictException(
          'Some of these collections were already paid or have changed. Reload and check the amount again.',
        );
      }
      throw err;
    }

    await this.audit.record({
      eventType: 'vendor.payout_recorded',
      actorId: staff.userId,
      actorType: 'admin',
      resourceType: 'vendor',
      resourceId: vendorId,
      // Amount and reference, never the account it went to.
      metadata: {
        payoutId: payout.id,
        amount: payout.net_payout,
        collections: payout.orders_count,
        paymentRef: payout.payment_ref,
        paymentMethod: payout.payment_method,
      },
      ...meta,
    });

    return toPaymentView(payout);
  }

  private async build(vendorId: string): Promise<OpsEarningsView> {
    const [collectionRows, payoutRows] = await Promise.all([
      this.payouts.listCollections(vendorId, COLLECTIONS_LIMIT),
      this.payouts.listPayouts(vendorId, PAYOUTS_LIMIT),
    ]);

    const collections = collectionRows
      .map(toCollectionView)
      .sort((a, b) => b.collectedAt.localeCompare(a.collectedAt));
    const unpaid = collections.filter((c) => !c.paid);

    return {
      owedNow: sum(unpaid.map((c) => c.amount)),
      paidTotal: sum(collections.filter((c) => c.paid).map((c) => c.amount)),
      collections,
      payments: payoutRows.map(toPaymentView),
      unpaidOrderIds: unpaid.map((c) => c.orderId),
    };
  }
}

function toCollectionView(row: CollectionRow): CollectionView {
  const redemption = Array.isArray(row.redemptions)
    ? row.redemptions[0]
    : row.redemptions;
  return {
    orderId: row.id,
    orderNumber: row.order_number,
    giftName: row.gift_templates?.name ?? 'Gift',
    amount: row.vendor_payout_amount,
    collectedAt: redemption?.completed_at ?? row.updated_at,
    paid: row.vendor_paid_at !== null,
    paidAt: row.vendor_paid_at,
  };
}

function toPaymentView(row: PayoutRow): PaymentView {
  return {
    id: row.id,
    amount: row.net_payout,
    collections: row.orders_count,
    paidAt: row.paid_at,
    method: row.payment_method,
    reference: row.payment_ref,
  };
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
