import type { Metadata } from "next";
import Link from "next/link";
import { opsFetch } from "@/lib/ops/api";
import {
  DELIVERY_STAGE_LABEL,
  type OpsDelivery,
  type OpsDeliveryStage,
  type VendorSummary,
} from "@/lib/ops/types";
import { DeliveryActions } from "./delivery-actions";

export const metadata: Metadata = { title: "Deliveries" };

/** Order matters: what needs a human first. */
const STAGE_ORDER: OpsDeliveryStage[] = [
  "needs_vendor",
  "unacknowledged",
  "awaiting_address",
  "preparing",
  "on_the_way",
];

/** How long each wait can run before it is worth a phone call. */
const NUDGE_AFTER_MIN: Record<OpsDeliveryStage, number> = {
  needs_vendor: 0,
  unacknowledged: 30,
  awaiting_address: 24 * 60,
  preparing: 4 * 60,
  on_the_way: 3 * 60,
};

/**
 * Every doorstep gift not yet delivered, grouped by what it is waiting
 * on. Anything past its nudge time is flagged: a vendor who hasn't seen
 * a delivery in 30 minutes needs a call, not a WhatsApp they also
 * haven't seen.
 */
export default async function DeliveriesPage() {
  const [deliveries, vendors] = await Promise.all([
    opsFetch<OpsDelivery[]>("/ops/deliveries"),
    opsFetch<VendorSummary[]>("/ops/vendors"),
  ]);
  const activeVendors = vendors
    .filter((v) => v.active)
    .map((v) => ({ id: v.id, name: v.businessName }));

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-xl font-semibold">Deliveries</h1>
        <p className="mt-1 text-zinc-600">
          Doorstep gifts not yet delivered. Vendors work these from their own link; step in here when they confirm by
          phone instead, or when one needs moving.
        </p>
      </header>

      {deliveries.length === 0 && (
        <p className="rounded border border-dashed border-zinc-300 bg-white px-4 py-8 text-center text-zinc-500">
          Nothing out for delivery.
        </p>
      )}

      {STAGE_ORDER.map((stage) => {
        const rows = deliveries.filter((d) => d.stage === stage);
        if (rows.length === 0) return null;
        return (
          <section key={stage} className="flex flex-col gap-2">
            <h2 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
              {DELIVERY_STAGE_LABEL[stage]} · {rows.length}
            </h2>
            <ul className="divide-y divide-zinc-100 rounded border border-zinc-200 bg-white">
              {rows.map((d) => {
                const waitedMin = minutesSince(d.waitingSince);
                const late = waitedMin >= NUDGE_AFTER_MIN[stage] && stage !== "needs_vendor";
                return (
                  <li key={d.orderId} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-medium">
                        <Link href={`/ops/orders/${d.orderId}`} className="hover:underline">
                          {d.giftName}
                        </Link>{" "}
                        <span className="font-mono text-xs text-zinc-500">{d.orderNumber}</span>
                      </p>
                      <p className="text-zinc-600">
                        For {d.recipientName}
                        {d.area ? ` · ${d.area}` : ""}
                        {d.vendorName ? ` · ${d.vendorName}` : ""}
                      </p>
                      <p className={late ? "font-medium text-amber-700" : "text-zinc-500"}>
                        {formatWait(waitedMin)}
                        {late ? " — chase it" : ""}
                      </p>
                    </div>
                    <DeliveryActions delivery={d} vendors={activeVendors} />
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** A server render is a one-off snapshot, so reading the clock here is the point. */
function minutesSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
}

function formatWait(minutes: number): string {
  if (minutes < 60) return `Waiting ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `Waiting ${hours} h`;
  return `Waiting ${Math.floor(hours / 24)} days`;
}
