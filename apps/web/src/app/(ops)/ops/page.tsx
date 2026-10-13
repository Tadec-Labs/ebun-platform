import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink, Card, PageHeader, StatCard, timeAgo } from "@/components/ops/ui";
import { formatNaira } from "@/lib/format-money";
import { opsFetch } from "@/lib/ops/api";
import { formatWhen } from "@/lib/ops/format-time";
import type { AttentionItem, OpsOverview } from "@/lib/ops/types";
import { StatusBadge } from "./orders/status-badge";

export const metadata: Metadata = { title: "Today" };

const URGENCY_DOT: Record<AttentionItem["urgency"], string> = {
  1: "bg-red-500",
  2: "bg-amber-500",
  3: "bg-zinc-300",
};

const KIND_LABEL: Record<AttentionItem["kind"], string> = {
  stuck_order: "Order",
  delivery: "Delivery",
  pickup: "Pickup",
  approval: "Approval",
  partner_details: "Partner",
};

/**
 * Ops' home. Answers, in order: is anything on fire, how is today going,
 * and what just happened. "Needs you" is the whole point of the page —
 * every row says what is wrong and links to where it is fixed, sorted so
 * money taken with nothing happening is always on top.
 */
export default async function TodayPage() {
  const overview = await opsFetch<OpsOverview>("/ops/overview");
  const urgent = overview.attention.filter((a) => a.urgency < 3);
  const tidy = overview.attention.filter((a) => a.urgency === 3);

  return (
    <>
      <PageHeader
        title={greeting()}
        description={lagosDate()}
        actions={
          <>
            <ButtonLink href="/ops/redeem" variant="secondary">
              Redeem a code
            </ButtonLink>
            <ButtonLink href="/ops/gifts/new">Add a gift</ButtonLink>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Paid orders today" value={overview.today.orders} href="/ops/orders" />
        <StatCard label="Taken today" value={formatNaira(overview.today.takings)} hint="What senders paid" />
        <StatCard label="Handed over today" value={overview.today.handedOver} hint="Collected or delivered" />
        <StatCard
          label="Owed to partners"
          value={formatNaira(overview.owed.total)}
          hint={
            overview.owed.partners > 0
              ? `${overview.owed.partners} ${overview.owed.partners === 1 ? "partner" : "partners"} waiting`
              : "All paid up"
          }
          href="/ops/payouts"
          tone={overview.owed.total > 0 ? "attention" : "default"}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card
          title={
            <span className="flex items-center gap-2">
              Needs you
              {urgent.length > 0 && (
                <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs font-semibold text-white">
                  {urgent.length}
                </span>
              )}
            </span>
          }
          flush
          className="lg:col-span-3"
        >
          {urgent.length === 0 ? (
            <div className="flex items-center gap-3 px-5 py-8">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">✓</span>
              <div>
                <p className="font-medium">All clear</p>
                <p className="text-zinc-600">No stuck orders, quiet vendors or waiting approvals.</p>
              </div>
            </div>
          ) : (
            <AttentionList items={urgent} />
          )}
          {tidy.length > 0 && (
            <details className="border-t border-zinc-100">
              <summary className="cursor-pointer px-5 py-3 text-zinc-600 hover:text-zinc-900">
                {tidy.length} partner {tidy.length === 1 ? "profile needs" : "profiles need"} finishing
              </summary>
              <AttentionList items={tidy} />
            </details>
          )}
        </Card>

        <Card
          title="Latest orders"
          action={
            <Link href="/ops/orders" className="text-zinc-600 hover:text-zinc-900">
              All orders →
            </Link>
          }
          flush
          className="lg:col-span-2"
        >
          {overview.recentOrders.length === 0 ? (
            <p className="px-5 py-8 text-zinc-600">No paid orders yet.</p>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {overview.recentOrders.map((order) => (
                <li key={order.id}>
                  <Link href={`/ops/orders/${order.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-zinc-50">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{order.giftName}</p>
                      <p className="truncate text-zinc-500">
                        {order.recipientName} · {formatWhen(order.createdAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="font-medium tabular-nums">{formatNaira(order.totalAmount)}</span>
                      <StatusBadge status={order.status} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function AttentionList({ items }: { items: AttentionItem[] }) {
  return (
    <ul className="divide-y divide-zinc-100">
      {items.map((item, i) => (
        <li key={`${item.href}-${i}`}>
          <Link href={item.href} className="group flex items-start gap-3 px-5 py-3.5 hover:bg-zinc-50">
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${URGENCY_DOT[item.urgency]}`} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-zinc-900">{item.title}</p>
              {item.detail && <p className="text-zinc-600">{item.detail}</p>}
              <p className="mt-0.5 text-xs text-zinc-400">
                {KIND_LABEL[item.kind]}
                {item.since ? ` · ${timeAgo(item.since)}` : ""}
              </p>
            </div>
            <span className="mt-0.5 shrink-0 text-zinc-400 group-hover:text-zinc-900" aria-hidden="true">
              →
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function lagosHour(): number {
  return Number(
    new Date().toLocaleString("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", hour12: false }),
  );
}

function greeting(): string {
  const hour = lagosHour();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function lagosDate(): string {
  return new Date().toLocaleDateString("en-NG", {
    timeZone: "Africa/Lagos",
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}
