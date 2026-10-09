import { Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus } from '@ebun/types';
import { AuditEventsRepository } from '../audit/audit-events.repository';
import type { AuditEventRow } from '../audit/audit-events.repository';
import { STUCK_FULFILLMENT_MINUTES } from '../jobs/jobs.config';
import { ListOrdersQueryDto, DEFAULT_PAGE_SIZE } from './dto/list-orders.dto';
import { OrderStateMachineService } from './order-state-machine.service';
import { OpsOrdersRepository } from './ops-orders.repository';
import type {
  OpsOrderDetailRow,
  OpsOrderListRow,
} from './ops-orders.repository';

export interface OpsOrderSummary {
  id: string;
  orderNumber: string | null;
  status: OrderStatus;
  giftName: string | null;
  recipientName: string;
  recipientPhone: string;
  vendorName: string | null;
  totalAmount: number; // kobo
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  scheduledSendAt: string | null;
  /** True when the stuck-fulfilment sweep would flag this order right now. */
  stuck: boolean;
}

export interface OpsOrderListResult {
  orders: OpsOrderSummary[];
  total: number;
  limit: number;
  offset: number;
  /**
   * Stuck orders across the WHOLE table, not just this page or this
   * filter — see OpsOrdersRepository.countStuck for why.
   */
  stuckCount: number;
  /** Minutes in fulfilment before an order counts as stuck, so the UI can say so. */
  stuckAfterMinutes: number;
}

export interface OpsOrderEvent {
  id: string;
  eventType: string;
  actorType: AuditEventRow['actor_type'];
  actorId: string | null;
  previousState: string | null;
  newState: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface OpsOrderDetail extends OpsOrderSummary {
  giftValue: number;
  deliveryFee: number;
  serviceFee: number;
  vendorPayoutAmount: number | null;
  vendorPaidAt: string | null;
  paystackReference: string | null;
  paymentVerifiedAt: string | null;
  /** Whether the sender attached a message and of what kind — never its contents. */
  messageType: 'text' | 'voice' | 'video' | null;
  revealTheme: string;
  revealOpenedAt: string | null;
  whatsappSentAt: string | null;
  deliveryAddress: string | null;
  deliveryZone: string | null;
  isDiasporaSender: boolean;
  isCorporateOrder: boolean;
  senderCountryCode: string | null;
  notes: string | null;
  /** Oldest first — a timeline reads forwards. */
  events: OpsOrderEvent[];
  /**
   * What the state machine would currently permit. Read-only: nothing
   * in /ops can perform a transition yet, and this is here so the page
   * can say "this order can only go to refunded from here" rather than
   * leaving the operator to guess.
   */
  allowedTransitions: {
    normal: OrderStatus[];
    adminOverride: OrderStatus[];
  };
  terminal: boolean;
  /** Echoed so the detail page doesn't hardcode the sweep's threshold. */
  stuckAfterMinutes: number;
}

/** A to-one embed arrives as an object, or as a one-element array if PostgREST hedges. */
function embedded<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/**
 * Read-only order visibility for ops.
 *
 * Before this, the only window into a live order was the Supabase table
 * editor, and the stuck-order sweep wrote into Railway logs nobody
 * tails. That is tolerable with zero customers and indefensible with
 * one: an order stuck mid-fulfilment is money already taken for a gift
 * that was never delivered, and nothing surfaced it.
 *
 * Deliberately read-only. Acting on a stuck order means retry or refund,
 * and the refund path does not exist yet (the `refunds` table has no
 * references anywhere in the codebase). Shipping buttons that transition
 * orders without a refund record behind them would make the books worse,
 * not better — so this ships as eyes first, hands second.
 */
@Injectable()
export class OpsOrdersService {
  constructor(
    private readonly orders: OpsOrdersRepository,
    private readonly auditEvents: AuditEventsRepository,
    private readonly stateMachine: OrderStateMachineService,
  ) {}

  private stuckCutoff(): Date {
    return new Date(Date.now() - STUCK_FULFILLMENT_MINUTES * 60_000);
  }

  async list(query: ListOrdersQueryDto): Promise<OpsOrderListResult> {
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const offset = query.offset ?? 0;
    const cutoff = this.stuckCutoff();

    const [page, stuckCount] = await Promise.all([
      this.orders.list(
        {
          statuses: query.status,
          from: query.from,
          to: query.to,
          search: query.search,
          stuckOnly: query.stuck === true,
          limit,
          offset,
        },
        cutoff,
      ),
      this.orders.countStuck(cutoff),
    ]);

    return {
      orders: page.rows.map((row) => this.toSummary(row, cutoff)),
      total: page.total,
      limit,
      offset,
      stuckCount,
      stuckAfterMinutes: STUCK_FULFILLMENT_MINUTES,
    };
  }

  async get(id: string): Promise<OpsOrderDetail> {
    const row = await this.orders.findById(id);
    if (!row) {
      throw new NotFoundException('Order not found.');
    }

    const events = await this.auditEvents.findForResource('order', id);

    return {
      ...this.toSummary(row, this.stuckCutoff()),
      giftValue: row.gift_value,
      deliveryFee: row.delivery_fee,
      serviceFee: row.service_fee,
      vendorPayoutAmount: row.vendor_payout_amount,
      vendorPaidAt: row.vendor_paid_at,
      paystackReference: row.paystack_reference,
      paymentVerifiedAt: row.payment_verified_at,
      messageType: row.message_type,
      revealTheme: row.reveal_theme,
      revealOpenedAt: row.reveal_opened_at,
      whatsappSentAt: row.whatsapp_sent_at,
      deliveryAddress: row.delivery_address,
      deliveryZone: row.delivery_zone,
      isDiasporaSender: row.is_diaspora_sender,
      isCorporateOrder: row.is_corporate_order,
      senderCountryCode: row.sender_country_code,
      notes: row.notes,
      events: events.map(toEvent),
      allowedTransitions: {
        normal: [...this.stateMachine.getNormalTransitions(row.status)],
        adminOverride: [
          ...this.stateMachine.getAdminOverrideTransitions(row.status),
        ],
      },
      terminal: this.stateMachine.isTerminal(row.status),
      stuckAfterMinutes: STUCK_FULFILLMENT_MINUTES,
    };
  }

  private toSummary(
    row: OpsOrderListRow | OpsOrderDetailRow,
    cutoff: Date,
  ): OpsOrderSummary {
    return {
      id: row.id,
      orderNumber: row.order_number,
      status: row.status,
      giftName: embedded(row.gift_template)?.name ?? null,
      recipientName: row.recipient_name,
      recipientPhone: row.recipient_phone,
      vendorName: embedded(row.vendor)?.business_name ?? null,
      totalAmount: row.total_amount,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
      scheduledSendAt: row.scheduled_send_at,
      // Computed here rather than queried per row: the same definition
      // the sweep uses (status + how long since updated_at), so the
      // list and the banner can never disagree.
      stuck:
        (row.status === OrderStatus.Processing ||
          row.status === OrderStatus.FulfillmentInProgress) &&
        new Date(row.updated_at) < cutoff,
    };
  }
}

function toEvent(row: AuditEventRow): OpsOrderEvent {
  return {
    id: row.id,
    eventType: row.event_type,
    actorType: row.actor_type,
    actorId: row.actor_id,
    previousState: row.previous_state,
    newState: row.new_state,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}
