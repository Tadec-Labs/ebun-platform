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

  // Only the fields that have something to say. The page previously
  // rendered every column in the row, which meant roughly half of it
  // was permanently empty — fees are hardcoded 0, vendor payout and
  // margin are never calculated, no vendor is ever assigned — and the
  // History panel, the only part that actually explains an order, sat
  // below all of it off the bottom of the screen. A field whose
  // feature does not exist yet is noise, not information.
  const details: { label: string; value: React.ReactNode }[] = [];
  const push = (label: string, value: React.ReactNode) =>
    details.push({ label, value });

  if (order.vendorName) push("Vendor", order.vendorName);
  if (order.messageType)
    // What KIND, never the contents — the message is between the sender
    // and one named person.
    push("Message", MESSAGE_KIND[order.messageType] ?? order.messageType);
  if (order.deliveryAddress) push("Address", order.deliveryAddress);
  if (order.deliveryZone) push("Zone", order.deliveryZone);
  if (order.serviceFee > 0) push("Service fee", formatNaira(order.serviceFee));
  if (order.deliveryFee > 0)
    push("Delivery fee", formatNaira(order.deliveryFee));
  if (order.vendorPayoutAmount !== null) {
    push("Vendor payout", formatNaira(order.vendorPayoutAmount));
    push(
      "Ebun margin",
      formatNaira(order.totalAmount - order.vendorPayoutAmount),
    );
  }
  if (order.vendorPaidAt) push("Vendor paid", formatWhen(order.vendorPaidAt));
  if (order.paystackReference)
    push(
      "Paystack ref",
      <span className="font-mono break-all">{order.paystackReference}</span>,
    );
  if (order.paymentVerifiedAt)
    push("Payment verified", formatWhen(order.paymentVerifiedAt));
  if (order.scheduledSendAt)
    push("Scheduled for", formatWhen(order.scheduledSendAt));
  if (order.whatsappSentAt)
    push("WhatsApp sent", formatWhen(order.whatsappSentAt));
  if (order.revealOpenedAt)
    push("Reveal opened", formatWhen(order.revealOpenedAt));
  push(
    "Expires",
    <>
      {formatWhen(order.expiresAt)}{" "}
      <span className="text-zinc-500">({formatRelative(order.expiresAt)})</span>
    </>,
  );
  if (order.isDiasporaSender)
    push(
      "Sender",
      `Diaspora${order.senderCountryCode ? ` (${order.senderCountryCode})` : ""}`,
    );
  if (order.isCorporateOrder) push("Corporate", "Yes");
  if (order.revealTheme !== "gold") push("Theme", order.revealTheme);

  return (
    <>
      <Link
        href="/ops/orders"
        className="text-zinc-600 underline-offset-2 hover:underline"
      >
        ← Orders
      </Link>

      <div className="mt-3 mb-4 flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-lg font-semibold">
          {order.orderNumber ?? order.id.slice(0, 8)}
        </h1>
        <StatusBadge status={order.status} />
        {order.stuck && <StuckBadge minutes={order.stuckAfterMinutes} />}
      </div>

      {order.stuck && (
        <p className="mb-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-red-900">
          This order was paid for and has been sitting mid-fulfilment since{" "}
          {formatRelative(order.updatedAt)}. Fulfilment runs inside the Paystack
          webhook and will not retry on its own — it needs a manual retry or a
          refund.
        </p>
      )}

      {/* The four things you need before reading anything else. */}
      <dl className="mb-6 grid gap-x-6 gap-y-3 rounded border border-zinc-200 bg-white p-4 sm:grid-cols-4">
        <Field label="Gift">{order.giftName ?? "—"}</Field>
        <Field label="Recipient">
          <div>{order.recipientName}</div>
          <div className="text-zinc-500">{order.recipientPhone}</div>
        </Field>
        <Field label="Sender paid">
          <span className="font-medium">{formatNaira(order.totalAmount)}</span>
        </Field>
        <Field label="Placed">
          <div>{formatWhen(order.createdAt)}</div>
          <div className="text-zinc-500">
            last change {formatRelative(order.updatedAt)}
          </div>
        </Field>
      </dl>

      {/* Directly under the summary, because this is what answers
          "what happened to this order" — the question the page exists
          for. Everything else is reference and sits below it. */}
      <section className="mb-6">
        <h2 className="mb-1 font-medium">History</h2>
        <p className="mb-3 text-zinc-600">
          Every recorded event for this order, oldest first, straight from the
          audit log.
        </p>
        {order.events.length === 0 ? (
          <div className="rounded border border-dashed border-zinc-300 bg-white px-6 py-8 text-center text-zinc-600">
            {/* An order with no events is itself a finding, not an
                empty state to shrug at. */}
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

      {details.length > 0 && (
        <details className="rounded border border-zinc-200 bg-white">
          <summary className="cursor-pointer px-4 py-3 font-medium select-none">
            Everything else ({details.length})
          </summary>
          <dl className="grid gap-x-6 gap-y-3 border-t border-zinc-100 px-4 py-4 sm:grid-cols-3">
            {details.map((item) => (
              <Field key={item.label} label={item.label}>
                {item.value}
              </Field>
            ))}
          </dl>
        </details>
      )}

      {order.notes && (
        <p className="mt-4 rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-zinc-700">
          {order.notes}
        </p>
      )}
    </>
  );
}
