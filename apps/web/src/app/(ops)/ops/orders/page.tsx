import Link from "next/link";
import { formatNaira } from "@/lib/format-money";
import { opsFetch } from "@/lib/ops/api";
import { formatWhen } from "@/lib/ops/format-time";
import { ORDER_STATUS_LABEL } from "@/lib/ops/types";
import type { OrderListResult, OrderStatusValue } from "@/lib/ops/types";
import { OrderFilters } from "./order-filters";
import { StatusBadge, StuckBadge } from "./status-badge";

const PAGE_SIZE = 50;

type Search = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function many(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

/** Builds a link to this same page with some params replaced. */
function hrefWith(
  params: URLSearchParams,
  changes: Record<string, string | null>,
): string {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) next.delete(key);
    else next.set(key, value);
  }
  const query = next.toString();
  return query ? `/ops/orders?${query}` : "/ops/orders";
}

export default async function OrdersPage({
  searchParams,
}: PageProps<"/ops/orders">) {
  const sp = (await searchParams) as Search;

  const search = one(sp.search);
  const fromDay = one(sp.from);
  const toDay = one(sp.to);
  const statuses = many(sp.status) as OrderStatusValue[];
  const stuck = one(sp.stuck) === "true";
  const offset = Math.max(0, Number.parseInt(one(sp.offset) || "0", 10) || 0);

  const query = new URLSearchParams();
  if (search) query.set("search", search);
  // The date inputs give a plain day. Widen to the full day in Lagos
  // time before sending: `from` is inclusive at 00:00 WAT, `to` is
  // exclusive at 00:00 WAT the following day, so picking the same date
  // for both still returns that whole day rather than nothing.
  if (fromDay) query.set("from", `${fromDay}T00:00:00+01:00`);
  if (toDay) query.set("to", `${nextDay(toDay)}T00:00:00+01:00`);
  for (const status of statuses) query.append("status", status);
  if (stuck) query.set("stuck", "true");
  query.set("limit", String(PAGE_SIZE));
  query.set("offset", String(offset));

  const result = await opsFetch<OrderListResult>(
    `/ops/orders?${query.toString()}`,
  );

  // Params for the pagination links — the user-facing ones, not the
  // widened timestamps above.
  const linkParams = new URLSearchParams();
  if (search) linkParams.set("search", search);
  if (fromDay) linkParams.set("from", fromDay);
  if (toDay) linkParams.set("to", toDay);
  for (const status of statuses) linkParams.append("status", status);
  if (stuck) linkParams.set("stuck", "true");

  const shownFrom = result.total === 0 ? 0 : offset + 1;
  const shownTo = Math.min(offset + result.orders.length, result.total);
  const hasPrev = offset > 0;
  const hasNext = offset + result.orders.length < result.total;

  return (
    <>
      <div className="mb-5">
        <h1 className="text-lg font-semibold">Orders</h1>
        <p className="text-zinc-600">
          {result.total} {result.total === 1 ? "order" : "orders"}
          {statuses.length > 0 || search || fromDay || toDay || stuck
            ? " matching"
            : " in total"}
        </p>
      </div>

      {/* Always shown, even when the list is filtered elsewhere: a stuck
          paid order is money taken for a gift that was never delivered,
          and it should not be possible to filter it out of sight. */}
      {result.stuckCount > 0 && !stuck && (
        <p className="mb-5 rounded border border-red-300 bg-red-50 px-3 py-2 text-red-900">
          <strong>
            {result.stuckCount}{" "}
            {result.stuckCount === 1 ? "order has" : "orders have"} been stuck
            in fulfilment for over {result.stuckAfterMinutes} minutes
          </strong>{" "}
          and will not retry on their own — each one is paid for and
          undelivered.{" "}
          <Link
            href={hrefWith(linkParams, { stuck: "true", offset: null })}
            className="underline"
          >
            Show them
          </Link>
        </p>
      )}

      <OrderFilters
        search={search}
        from={fromDay}
        to={toDay}
        statuses={statuses}
        stuck={stuck}
        stuckAfterMinutes={result.stuckAfterMinutes}
      />

      {result.orders.length === 0 ? (
        <div className="rounded border border-dashed border-zinc-300 bg-white px-6 py-12 text-center">
          <p className="mb-1 font-medium">
            {result.total === 0 && !search && !stuck && statuses.length === 0
              ? "No orders yet"
              : "Nothing matches those filters"}
          </p>
          <p className="text-zinc-600">
            {result.total === 0 && !search && !stuck && statuses.length === 0
              ? "Orders appear here the moment a sender starts checkout."
              : "Try widening the dates or clearing the status filter."}
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded border border-zinc-200 bg-white">
            <table className="w-full min-w-[760px] text-left">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-xs tracking-wide text-zinc-500 uppercase">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Order</th>
                  <th className="px-4 py-2.5 font-medium">Recipient</th>
                  <th className="px-4 py-2.5 font-medium">Gift</th>
                  <th className="px-4 py-2.5 font-medium">Paid</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Placed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {result.orders.map((order) => (
                  <tr
                    key={order.id}
                    className={
                      order.stuck ? "bg-red-50/60" : "hover:bg-zinc-50"
                    }
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/ops/orders/${order.id}`}
                        className="font-mono font-medium text-zinc-900 underline-offset-2 hover:underline"
                      >
                        {order.orderNumber ?? order.id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{order.recipientName}</div>
                      <div className="text-zinc-500">
                        {order.recipientPhone}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div>{order.giftName ?? "—"}</div>
                      {order.vendorName && (
                        <div className="text-zinc-500">{order.vendorName}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {formatNaira(order.totalAmount)}
                    </td>
                    <td className="space-x-1.5 px-4 py-3">
                      <StatusBadge status={order.status} />
                      {order.stuck && (
                        <StuckBadge minutes={result.stuckAfterMinutes} />
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-zinc-600">
                      {formatWhen(order.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex items-center justify-between text-zinc-600">
            <span>
              Showing {shownFrom}–{shownTo} of {result.total}
            </span>
            <span className="space-x-3">
              {hasPrev && (
                <Link
                  href={hrefWith(linkParams, {
                    offset: String(Math.max(0, offset - PAGE_SIZE)),
                  })}
                  className="underline-offset-2 hover:underline"
                >
                  ← Previous
                </Link>
              )}
              {hasNext && (
                <Link
                  href={hrefWith(linkParams, {
                    offset: String(offset + PAGE_SIZE),
                  })}
                  className="underline-offset-2 hover:underline"
                >
                  Next →
                </Link>
              )}
            </span>
          </div>
        </>
      )}

      {statuses.length > 0 && (
        <p className="mt-4 text-xs text-zinc-500">
          Filtered to: {statuses.map((s) => ORDER_STATUS_LABEL[s]).join(", ")}
        </p>
      )}
    </>
  );
}

/** "2026-10-09" → "2026-10-10". Date-only arithmetic, no timezone involved. */
function nextDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
