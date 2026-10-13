import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { FulfillmentType, OrderStatus } from '@ebun/types';
import { AuditService } from '../audit/audit.service';
import { OrdersService } from '../orders/orders.service';
import type { TransitionActor } from '../orders/orders.service';
import { OrderTransitionConflictException } from '../orders/exceptions/order-transition-conflict.exception';
import { InvalidOrderTransitionException } from '../orders/exceptions/invalid-order-transition.exception';
import {
  DeliveriesRepository,
  DeliveryCandidateRow,
  DeliveryFulfillmentRow,
  DeliveryOrderRow,
  OpenDeliveryRow,
} from './deliveries.repository';

/** Where a doorstep gift is, in the recipient's terms. */
export type DeliveryStage =
  'awaiting_address' | 'preparing' | 'on_the_way' | 'delivered';

/** What the recipient's gift page shows about their delivery. */
export interface RecipientDeliveryView {
  stage: DeliveryStage;
  address: string | null;
  area: string | null;
  phone: string | null;
  note: string | null;
  /** The business preparing it, once one is assigned. */
  placeName: string | null;
  riderName: string | null;
  riderPhone: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  /** Ops' timing note on the gift, e.g. "Same day if ordered before 2pm". */
  window: string | null;
  /** True until a rider has it — the address can still be changed. */
  canChangeAddress: boolean;
}

/** A delivery on the vendor's "To deliver" list. Everything a rider needs, nothing more. */
export interface VendorDeliveryView {
  orderId: string;
  orderNumber: string | null;
  giftName: string;
  recipientName: string;
  phone: string;
  address: string;
  area: string | null;
  note: string | null;
  /** new = not yet acknowledged; acknowledged = "Got it"; on_the_way = rider has it. */
  stage: 'new' | 'acknowledged' | 'on_the_way';
  /** kobo — item price plus the delivery fee, credited when it's delivered. */
  youReceive: number | null;
  assignedAt: string | null;
}

/** One open delivery as ops sees it, with what (if anything) it is waiting on. */
export interface OpsDeliveryView {
  orderId: string;
  orderNumber: string | null;
  giftName: string;
  recipientName: string;
  area: string | null;
  vendorId: string | null;
  vendorName: string | null;
  stage:
    | 'awaiting_address'
    | 'needs_vendor'
    | 'unacknowledged'
    | 'preparing'
    | 'on_the_way';
  /** When the order entered its current wait — what "how long has this been stuck" is measured from. */
  waitingSince: string;
}

export interface DeliveryDetailsInput {
  address: string;
  area: string;
  phone?: string | null;
  note?: string | null;
}

type DeliveryActor =
  { kind: 'vendor'; vendorId: string } | { kind: 'staff'; userId: string };

/**
 * Doorstep delivery for physical gifts.
 *
 *   recipient gives an address  ->  a vendor is assigned
 *   vendor: "Got it"            ->  (acknowledged; nothing changes for the order)
 *   vendor: "Out for delivery"  ->  fulfillment_in_progress -> dispatched
 *   vendor/ops: "Delivered"     ->  dispatched -> delivered, vendor credited
 *   recipient unwraps message   ->  delivered -> fulfilled
 *
 * Every order-status change goes through OrdersService.transitionNormal
 * (the state machine + atomic compare-and-swap), so two taps on
 * "Delivered" — or a vendor and ops at the same moment — produce one
 * delivery and one credit, and the loser gets a plain "already done".
 *
 * Vendor assignment is automatic and boring on purpose: a vendor who
 * offers the gift, preferring one that is taking orders and lists the
 * recipient's area. With one vendor per gift (the launch reality) that is
 * simply "the vendor". Ops can reassign from /ops at any point before a
 * rider has it.
 */
@Injectable()
export class DeliveriesService {
  private readonly logger = new Logger(DeliveriesService.name);

  constructor(
    private readonly repository: DeliveriesRepository,
    private readonly orders: OrdersService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------
  // Recipient
  // ---------------------------------------------------------------------

  async forRecipient(
    orderId: string,
    orderStatus: OrderStatus,
  ): Promise<RecipientDeliveryView | null> {
    const [order, fulfillment] = await Promise.all([
      this.repository.findOrder(orderId),
      this.repository.findFulfillment(orderId),
    ]);
    if (!order) return null;

    const placeName = fulfillment?.vendor_id
      ? await this.repository.vendorName(fulfillment.vendor_id)
      : null;
    const dispatched = Boolean(fulfillment?.rider_dispatched_at);

    return {
      stage: recipientStage(orderStatus, order, fulfillment),
      address: order.delivery_address,
      area: order.delivery_zone,
      phone: order.delivery_phone ?? order.recipient_phone,
      note: order.delivery_note,
      placeName,
      riderName: fulfillment?.rider_name ?? null,
      riderPhone: fulfillment?.rider_phone ?? null,
      dispatchedAt: fulfillment?.rider_dispatched_at ?? null,
      deliveredAt: fulfillment?.delivered_at ?? null,
      window: order.gift_templates?.delivery_window ?? null,
      canChangeAddress:
        orderStatus === OrderStatus.FulfillmentInProgress && !dispatched,
    };
  }

  /**
   * "Bring it here." Allowed until a rider has it; changing the address
   * after the vendor said "Got it" puts it back in front of them as new.
   */
  async setRecipientDetails(
    orderId: string,
    input: DeliveryDetailsInput,
  ): Promise<void> {
    const order = await this.requirePhysicalOrder(orderId);
    const fulfillment = await this.repository.findFulfillment(orderId);
    if (
      order.status !== OrderStatus.FulfillmentInProgress ||
      !fulfillment ||
      fulfillment.rider_dispatched_at
    ) {
      throw new BadRequestException(
        fulfillment?.rider_dispatched_at
          ? "It's already on its way, so the address can't be changed here. Call the rider or the shop."
          : "This gift can't take a delivery address right now.",
      );
    }

    const details = {
      address: clean(input.address),
      area: clean(input.area),
      phone: input.phone ? clean(input.phone) : null,
      note: input.note ? clean(input.note) : null,
    };
    const hadAddress = Boolean(order.delivery_address);

    const saved = await this.repository.saveRecipientDetails(orderId, details);
    if (!saved) {
      throw new ConflictException(
        'This gift has changed since you opened it. Reload the page.',
      );
    }

    let vendorId = fulfillment.vendor_id;
    if (!vendorId) {
      vendorId = await this.autoAssign(order, details.area);
    } else if (hadAddress) {
      await this.repository.clearAcknowledgement(orderId);
    }

    await this.audit.record({
      eventType: hadAddress
        ? 'order.delivery_details_changed'
        : 'order.delivery_details_added',
      actorId: null,
      actorType: 'user',
      resourceType: 'order',
      resourceId: orderId,
      // The area only — the full address is personal data and already on
      // the order; the audit trail needs the fact, not a second copy.
      metadata: { area: details.area, vendorId },
    });
  }

  /** The recipient unwrapped the message after delivery: the gift is complete. */
  async markOpened(orderId: string): Promise<void> {
    try {
      await this.orders.transitionNormal(
        orderId,
        OrderStatus.Delivered,
        OrderStatus.Fulfilled,
        { type: 'user' },
      );
    } catch (err) {
      // A second device or a double tap got there first — same outcome.
      if (err instanceof OrderTransitionConflictException) return;
      throw err;
    }
  }

  // ---------------------------------------------------------------------
  // Vendor
  // ---------------------------------------------------------------------

  async listForVendor(vendorId: string): Promise<VendorDeliveryView[]> {
    const rows = await this.repository.listOpen(vendorId);
    const views: VendorDeliveryView[] = [];
    for (const row of rows) {
      const order = row.orders;
      // Assigned but no address can only happen if ops assigned early;
      // there is nothing a rider can do with it yet.
      if (!order?.delivery_address) continue;
      const price = await this.repository.vendorPrice(
        vendorId,
        order.gift_template_id,
      );
      views.push({
        orderId: order.id,
        orderNumber: order.order_number,
        giftName: order.gift_templates?.name ?? 'Gift',
        recipientName: order.recipient_name,
        phone: order.delivery_phone ?? order.recipient_phone,
        address: order.delivery_address,
        area: order.delivery_zone,
        note: order.delivery_note,
        stage: row.rider_dispatched_at
          ? 'on_the_way'
          : row.vendor_accepted_at
            ? 'acknowledged'
            : 'new',
        youReceive: price === null ? null : price + (order.delivery_fee ?? 0),
        assignedAt: row.vendor_notified_at,
      });
    }
    return views;
  }

  async acknowledge(vendorId: string, orderId: string): Promise<void> {
    const done = await this.repository.acknowledge(orderId, vendorId);
    if (!done) {
      throw new NotFoundException('No delivery like that for your shop.');
    }
    await this.audit.record({
      eventType: 'order.delivery_acknowledged',
      actorId: null,
      actorType: 'vendor',
      resourceType: 'order',
      resourceId: orderId,
      metadata: { vendorId },
    });
  }

  // ---------------------------------------------------------------------
  // Vendor or ops
  // ---------------------------------------------------------------------

  async dispatch(
    actor: DeliveryActor,
    orderId: string,
    rider: { name?: string | null; phone?: string | null } = {},
  ): Promise<void> {
    const { order } = await this.requireActionable(actor, orderId);
    if (order.status !== OrderStatus.FulfillmentInProgress) {
      throw new BadRequestException(
        order.status === OrderStatus.Dispatched
          ? "It's already marked as on its way."
          : "This delivery can't be sent out right now.",
      );
    }
    await this.toDispatched(actor, order, {
      name: rider.name ? clean(rider.name) : null,
      phone: rider.phone ? clean(rider.phone) : null,
    });
  }

  /**
   * Handed over at the door. Also accepted straight from "preparing" — a
   * busy shop that forgot to tap "Out for delivery" has still delivered
   * it, and making them tap twice helps nobody.
   */
  async markDelivered(actor: DeliveryActor, orderId: string): Promise<void> {
    const { order, fulfillment } = await this.requireActionable(actor, orderId);
    if (order.status === OrderStatus.FulfillmentInProgress) {
      await this.toDispatched(actor, order, { name: null, phone: null });
      order.status = OrderStatus.Dispatched;
    }
    if (order.status !== OrderStatus.Dispatched) {
      throw new BadRequestException(
        order.status === OrderStatus.Delivered ||
          order.status === OrderStatus.Fulfilled
          ? 'Already marked as delivered.'
          : "This delivery can't be marked delivered right now.",
      );
    }

    await this.transition(
      actor,
      order.id,
      OrderStatus.Dispatched,
      OrderStatus.Delivered,
    );
    await this.repository.markDelivered(
      order.id,
      actor.kind === 'vendor' ? 'vendor' : 'ops',
    );

    const vendorId = fulfillment.vendor_id as string;
    const price = await this.repository.vendorPrice(
      vendorId,
      order.gift_template_id,
    );
    if (price === null) {
      // Only possible if the offering was deleted after assignment. The
      // delivery itself stands; the credit needs a human, and ops sees
      // this order with no payout amount.
      this.logger.error(
        `Order ${order.id} delivered by vendor ${vendorId}, but they no longer have an offering for this gift — no payout recorded. Set it by hand.`,
      );
    } else {
      await this.repository.recordVendorCredit(
        order.id,
        vendorId,
        price + (order.delivery_fee ?? 0),
      );
    }

    await this.audit.record({
      eventType: 'order.delivered',
      ...this.auditActor(actor),
      resourceType: 'order',
      resourceId: order.id,
      metadata: {
        vendorId,
        credited: price === null ? null : price + (order.delivery_fee ?? 0),
      },
    });
  }

  // ---------------------------------------------------------------------
  // Ops
  // ---------------------------------------------------------------------

  async listForOps(): Promise<OpsDeliveryView[]> {
    const rows = await this.repository.listOpen();
    return rows.filter((row) => row.orders).map(toOpsView);
  }

  /** Give the delivery to a specific vendor — the fix when the automatic choice was wrong or impossible. */
  async assignVendor(
    staffUserId: string,
    orderId: string,
    vendorId: string,
  ): Promise<void> {
    const order = await this.requirePhysicalOrder(orderId);
    if (order.status !== OrderStatus.FulfillmentInProgress) {
      throw new BadRequestException(
        'Only a delivery that hasn’t left yet can be given to another vendor.',
      );
    }
    const candidates = await this.repository.listCandidates(
      order.gift_template_id,
    );
    const candidate = candidates.find((c) => c.vendors?.id === vendorId);
    if (!candidate?.vendors?.active) {
      throw new BadRequestException(
        'That vendor doesn’t offer this gift (or is switched off). Add the gift to their items first.',
      );
    }
    const done = await this.repository.assignVendor(orderId, vendorId);
    if (!done) {
      throw new ConflictException(
        'This delivery just changed. Reload and try again.',
      );
    }
    await this.audit.record({
      eventType: 'order.delivery_vendor_assigned',
      actorId: staffUserId,
      actorType: 'admin',
      resourceType: 'order',
      resourceId: orderId,
      metadata: { vendorId },
    });
  }

  // ---------------------------------------------------------------------

  private async autoAssign(
    order: DeliveryOrderRow,
    area: string,
  ): Promise<string | null> {
    const candidates = await this.repository.listCandidates(
      order.gift_template_id,
    );
    const chosen = chooseVendor(candidates, area);
    if (!chosen) {
      this.logger.warn(
        `Order ${order.id}: delivery address in, but no active vendor offers this gift — needs assigning in /ops.`,
      );
      return null;
    }
    await this.repository.assignVendor(order.id, chosen);
    return chosen;
  }

  private async toDispatched(
    actor: DeliveryActor,
    order: DeliveryOrderRow,
    rider: { name: string | null; phone: string | null },
  ): Promise<void> {
    if (!order.delivery_address) {
      throw new BadRequestException(
        "The recipient hasn't given an address yet, so there's nowhere to send it.",
      );
    }
    await this.transition(
      actor,
      order.id,
      OrderStatus.FulfillmentInProgress,
      OrderStatus.Dispatched,
    );
    await this.repository.markDispatched(order.id, rider);
    await this.audit.record({
      eventType: 'order.delivery_dispatched',
      ...this.auditActor(actor),
      resourceType: 'order',
      resourceId: order.id,
      metadata: { riderName: rider.name },
    });
  }

  private async transition(
    actor: DeliveryActor,
    orderId: string,
    from: OrderStatus,
    to: OrderStatus,
  ): Promise<void> {
    const transitionActor: TransitionActor =
      actor.kind === 'vendor'
        ? { type: 'vendor' }
        : { type: 'admin', id: actor.userId };
    try {
      await this.orders.transitionNormal(orderId, from, to, transitionActor);
    } catch (err) {
      if (
        err instanceof OrderTransitionConflictException ||
        err instanceof InvalidOrderTransitionException
      ) {
        throw new ConflictException(
          'This delivery just changed (someone else may have updated it). Reload to see where it is.',
        );
      }
      throw err;
    }
  }

  /** Loads the order and checks the caller may act on it: vendors only on their own deliveries. */
  private async requireActionable(
    actor: DeliveryActor,
    orderId: string,
  ): Promise<{ order: DeliveryOrderRow; fulfillment: DeliveryFulfillmentRow }> {
    const [order, fulfillment] = await Promise.all([
      this.repository.findOrder(orderId),
      this.repository.findFulfillment(orderId),
    ]);
    const mine =
      actor.kind === 'staff' || fulfillment?.vendor_id === actor.vendorId;
    if (!order || !fulfillment || !mine) {
      // Same answer for "not yours" and "doesn't exist".
      throw new NotFoundException('No delivery like that for your shop.');
    }
    if (!fulfillment.vendor_id) {
      throw new BadRequestException(
        'No vendor is delivering this yet. Assign one first.',
      );
    }
    return { order, fulfillment };
  }

  private async requirePhysicalOrder(
    orderId: string,
  ): Promise<DeliveryOrderRow> {
    const order = await this.repository.findOrder(orderId);
    if (!order) throw new NotFoundException('No gift found.');
    if (order.gift_templates?.delivery_type !== FulfillmentType.Physical) {
      throw new BadRequestException('This gift isn’t delivered.');
    }
    return order;
  }

  private auditActor(actor: DeliveryActor) {
    return actor.kind === 'vendor'
      ? { actorId: null, actorType: 'vendor' as const }
      : { actorId: actor.userId, actorType: 'admin' as const };
  }
}

// -------------------------------------------------------------------------

function recipientStage(
  status: OrderStatus,
  order: DeliveryOrderRow,
  fulfillment: DeliveryFulfillmentRow | null,
): DeliveryStage {
  if (status === OrderStatus.Delivered || status === OrderStatus.Fulfilled) {
    return 'delivered';
  }
  if (status === OrderStatus.Dispatched || fulfillment?.rider_dispatched_at) {
    return 'on_the_way';
  }
  return order.delivery_address ? 'preparing' : 'awaiting_address';
}

/**
 * The automatic pick. Active vendors with an approved offering only;
 * among them, prefer taking-orders-today over paused, then a listed area
 * match over none, then name order so the choice is stable. A paused
 * vendor is still better than nobody — the order is already paid for.
 */
export function chooseVendor(
  candidates: DeliveryCandidateRow[],
  area: string,
): string | null {
  const wanted = normaliseArea(area);
  const scored = candidates
    .filter((c) => c.vendors?.active && c.approved)
    .map((c) => {
      const zones = [
        ...(c.vendors?.delivery_zones ?? []),
        ...(c.vendors?.service_areas ?? []),
      ].map(normaliseArea);
      const covers =
        wanted.length > 0 &&
        zones.some(
          (z) => z.length > 0 && (wanted.includes(z) || z.includes(wanted)),
        );
      return {
        id: c.vendors!.id,
        name: c.vendors!.business_name,
        score: (c.available ? 2 : 0) + (covers ? 1 : 0),
      };
    })
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return scored[0]?.id ?? null;
}

function normaliseArea(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function toOpsView(row: OpenDeliveryRow): OpsDeliveryView {
  const order = row.orders!;
  let stage: OpsDeliveryView['stage'];
  let waitingSince: string;
  if (!order.delivery_address) {
    stage = 'awaiting_address';
    waitingSince = row.created_at;
  } else if (!row.vendor_id) {
    stage = 'needs_vendor';
    waitingSince = order.delivery_details_at ?? row.created_at;
  } else if (row.rider_dispatched_at) {
    stage = 'on_the_way';
    waitingSince = row.rider_dispatched_at;
  } else if (!row.vendor_accepted_at) {
    stage = 'unacknowledged';
    waitingSince =
      row.vendor_notified_at ?? order.delivery_details_at ?? row.created_at;
  } else {
    stage = 'preparing';
    waitingSince = row.vendor_accepted_at;
  }
  return {
    orderId: order.id,
    orderNumber: order.order_number,
    giftName: order.gift_templates?.name ?? 'Gift',
    recipientName: order.recipient_name,
    area: order.delivery_zone,
    vendorId: row.vendor_id,
    vendorName: row.vendors?.business_name ?? null,
    stage,
    waitingSince,
  };
}
