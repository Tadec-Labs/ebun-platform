import Link from "next/link";
import { notFound } from "next/navigation";
import { formatNaira } from "@/lib/format-money";
import { OpsApiError, opsFetch } from "@/lib/ops/api";
import {
  formatRelative,
  formatWhen,
  formatWhenPrecise,
} from "@/lib/ops/format-time";
import { ORDER_STATUS_LABEL } from "@/lib/ops/types";
import type {
  OrderDetail,
  OrderEvent,
  OrderStatusValue,
} from "@/lib/ops/types";
import { StatusBadge, StuckBadge } from "../status-badge";

const MESSAGE_KIND: Record<string, string> = {
  text: "A written message",
  voice: "A voice note",
  video: "A video message",
};

/**
 * Audit event types the schema documents, in plain language. Anything
 * not listed falls back to the raw type rather than being hidden — an
 * unrecognised event is exactly the thing you want to see in a
 * timeline, not the thing to swallow.
 */
const EVENT_LABEL: Record<string, string> = {
  ORDER_CREATED: "Order created",
  PAYMENT_INITIATED: "Payment started",
  PAYMENT_CONFIRMED: "Payment confirmed",
  PAYMENT_FAILED: "Payment failed",
  PAYMENT_WEBHOOK_DUPLICATE: "Duplicate payment webhook ignored",
  ORDER_STATUS_CHANGED: "Status changed",
  GIFT_REVEAL_SENT: "Reveal link sent",
  GIFT_REVEAL_OPENED: "Reveal link opened",
  REDEMPTION_INITIATED: "Collection started",
  REDEMPTION_COMPLETED: "Collected",
  REDEMPTION_FAILED: "Collection failed",
  REDEMPTION_DUPLICATE_ATTEMPT: "Duplicate collection attempt blocked",
  VENDOR_NOTIFIED: "Vendor notified",
  VENDOR_ACCEPTED: "Vendor accepted",
  VENDOR_DECLINED: "Vendor declined",
  VENDOR_TIMEOUT: "Vendor didn’t respond",
  FULFILLMENT_STARTED: "Fulfilment started",
  FULFILLMENT_COMPLETED: "Fulfilment completed",
  FULFILLMENT_FAILED: "Fulfilment failed",
  ORDER_CANCELLED: "Order cancelled",
  REFUND_INITIATED: "Refund started",
  REFUND_COMPLETED: "Refunded",
};

const ACTOR_LABEL: Record<OrderEvent["actorType"], string> = {
  user: "Sender",
  vendor: "Vendor",
  system: "System",
  webhook: "Paystack webhook",
  admin: "Staff",
  cron: "Scheduled job",
};

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs tracking-wide text-zinc-500 uppercase">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

function statusName(value: string | null): string {
  if (!value) return "—";
  return ORDER_STATUS_LABEL[value as OrderStatusValue] ?? value;
}

export default async function OrderDetailPage({
  params,
}: PageProps<"/ops/orders/[id]">) {
  const { id } = await params;

  let order: OrderDetail;
  try {
    order = await opsFetch<OrderDetail>(`/ops/orders/${id}`);
  } catch (error) {
    // opsFetch redirects on 401/403 by throwing, so anything caught
    // here that isn't a 404 is a real failure worth surfacing as one.
    if (error instanceof OpsApiError && error.status === 404) notFound();
    throw error;
  }

  const margin =
    order.vendorPayoutAmount === null
      ? null
      : order.totalAmount - order.vendorPayoutAmount;

  return (
    <>
      <Link
        href="/ops/orders"
        className="text-zinc-600 underline-offset-2 hover:underline"
      >
        ← Orders
      </Link>

      <div className="mt-3 mb-5 flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-lg font-semibold">
          {order.orderNumber ?? order.id.slice(0, 8)}
        </h1>
        <StatusBadge status={order.status} />
        {order.stuck && <StuckBadge minutes={order.stuckAfterMinutes} />}
      </div>

      {order.stuck && (
        <p className="mb-5 rounded border border-red-300 bg-red-50 px-3 py-2 text-red-900">
          This order was paid for and has been sitting mid-fulfilment since{" "}
          {formatRelative(order.updatedAt)}. Fulfilment runs inside the Paystack
          webhook and will not retry on its own — it needs a manual retry or a
          refund.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded border border-zinc-200 bg-white p-4">
          <h2 className="mb-3 font-medium">Gift</h2>
          <dl className="grid grid-cols-2 gap-3">
            <Field label="Gift">{order.giftName ?? "—"}</Field>
            <Field label="Vendor">
              {order.vendorName ?? (
                <span className="text-amber-700">Not assigned</span>
              )}
            </Field>
            <Field label="Recipient">{order.recipientName}</Field>
            <Field label="Phone">{order.recipientPhone}</Field>
            <Field label="Message">
              {order.messageType ? (
                // Deliberately what KIND, never the contents — the
                // message is between the sender and one named person.
                (MESSAGE_KIND[order.messageType] ?? order.messageType)
              ) : (
                <span className="text-zinc-500">None</span>
              )}
            </Field>
            <Field label="Theme">{order.revealTheme}</Field>
            {order.deliveryAddress && (
              <Field label="Address">{order.deliveryAddress}</Field>
            )}
            {order.deliveryZone && (
              <Field label="Zone">{order.deliveryZone}</Field>
            )}
          </dl>
        </section>

        <section className="rounded border border-zinc-200 bg-white p-4">
          <h2 className="mb-3 font-medium">Money</h2>
          <dl className="grid grid-cols-2 gap-3">
            <Field label="Sender paid">
              <span className="font-medium">
                {formatNaira(order.totalAmount)}
              </span>
            </Field>
            <Field label="Gift value">{formatNaira(order.giftValue)}</Field>
            <Field label="Service fee">{formatNaira(order.serviceFee)}</Field>
            <Field label="Delivery fee">{formatNaira(order.deliveryFee)}</Field>
            <Field label="Vendor payout">
              {order.vendorPayoutAmount === null ? (
                <span className="text-zinc-500">Not calculated</span>
              ) : (
                formatNaira(order.vendorPayoutAmount)
              )}
            </Field>
            <Field label="Ebun margin">
              {margin === null ? (
                <span className="text-zinc-500">—</span>
              ) : (
                formatNaira(margin)
              )}
            </Field>
            <Field label="Paystack ref">
              <span className="font-mono break-all">
                {order.paystackReference ?? "—"}
              </span>
            </Field>
            <Field label="Payment verified">
              {order.paymentVerifiedAt ? (
                formatWhen(order.paymentVerifiedAt)
              ) : (
                <span className="text-amber-700">Never</span>
              )}
            </Field>
          </dl>
        </section>

        <section className="rounded border border-zinc-200 bg-white p-4">
          <h2 className="mb-3 font-medium">Delivery</h2>
          <dl className="grid grid-cols-2 gap-3">
            <Field label="Placed">{formatWhen(order.createdAt)}</Field>
            <Field label="Last change">
              {formatWhen(order.updatedAt)}{" "}
              <span className="text-zinc-500">
                ({formatRelative(order.updatedAt)})
              </span>
            </Field>
            <Field label="Scheduled for">
              {order.scheduledSendAt
                ? formatWhen(order.scheduledSendAt)
                : "Sent immediately"}
            </Field>
            <Field label="WhatsApp sent">
              {order.whatsappSentAt ? formatWhen(order.whatsappSentAt) : "—"}
            </Field>
            <Field label="Reveal opened">
              {order.revealOpenedAt
                ? formatWhen(order.revealOpenedAt)
                : "Not yet"}
            </Field>
            <Field label="Expires">
              {formatWhen(order.expiresAt)}{" "}
              <span className="text-zinc-500">
                ({formatRelative(order.expiresAt)})
              </span>
            </Field>
            <Field label="Sender">
              {order.isDiasporaSender
                ? `Diaspora${order.senderCountryCode ? ` (${order.senderCountryCode})` : ""}`
                : "Nigeria"}
            </Field>
            <Field label="Corporate">
              {order.isCorporateOrder ? "Yes" : "No"}
            </Field>
          </dl>
          {order.notes && (
            <p className="mt-3 rounded bg-zinc-50 px-3 py-2 text-zinc-700">
              {order.notes}
            </p>
          )}
        </section>

        <section className="rounded border border-zinc-200 bg-white p-4">
          <h2 className="mb-1 font-medium">Where it can go next</h2>
          <p className="mb-3 text-zinc-600">
            What the order state machine currently permits. Nothing here is
            actionable yet — transitions still happen in the API.
          </p>
          <dl className="space-y-3">
            <Field label="Automatically">
              {order.allowedTransitions.normal.length === 0 ? (
                <span className="text-zinc-500">
                  Nowhere — nothing moves this on its own.
                </span>
              ) : (
                order.allowedTransitions.normal.map(statusName).join(", ")
              )}
            </Field>
            <Field label="By staff override">
              {order.allowedTransitions.adminOverride.length === 0 ? (
                <span className="text-zinc-500">Nothing available.</span>
              ) : (
                order.allowedTransitions.adminOverride
                  .map(statusName)
                  .join(", ")
              )}
            </Field>
          </dl>
          {order.terminal && (
            <p className="mt-3 text-zinc-600">
              This order has reached the end of its life.
            </p>
          )}
        </section>
      </div>

      <section className="mt-6">
        <h2 className="mb-1 font-medium">History</h2>
        <p className="mb-3 text-zinc-600">
          Every recorded event for this order, oldest first, straight from the
          audit log.
        </p>
        {order.events.length === 0 ? (
          <div className="rounded border border-dashed border-zinc-300 bg-white px-6 py-8 text-center text-zinc-600">
            {/* Worth saying out loud: an order with no events is itself a
                finding, not an empty state to shrug at. */}
            Nothing recorded. Every state change should write an audit event, so
            an order with none is worth investigating.
          </div>
        ) : (
          <ol className="overflow-hidden rounded border border-zinc-200 bg-white">
            {order.events.map((event) => (
              <li
                key={event.id}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-zinc-100 px-4 py-3 last:border-b-0"
              >
                <span className="w-44 shrink-0 font-mono text-xs text-zinc-500">
                  {formatWhenPrecise(event.createdAt)}
                </span>
                <span className="font-medium">
                  {EVENT_LABEL[event.eventType] ?? event.eventType}
                </span>
                {(event.previousState ?? event.newState) && (
                  <span className="text-zinc-600">
                    {statusName(event.previousState)} →{" "}
                    {statusName(event.newState)}
                  </span>
                )}
                <span className="text-zinc-500">
                  {ACTOR_LABEL[event.actorType]}
                </span>
                {event.metadata && Object.keys(event.metadata).length > 0 && (
                  <details className="basis-full">
                    <summary className="cursor-pointer text-xs text-zinc-500 select-none">
                      Details
                    </summary>
                    <pre className="mt-1 overflow-x-auto rounded bg-zinc-50 p-2 text-xs text-zinc-700">
                      {JSON.stringify(event.metadata, null, 2)}
                    </pre>
                  </details>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
