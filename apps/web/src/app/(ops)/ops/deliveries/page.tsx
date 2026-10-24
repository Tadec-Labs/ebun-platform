import type { Metadata } from "next";
import Link from "next/link";
import { Card, EmptyState, PageHeader, Pill } from "@/components/ops/ui";
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
  "missed",
  "awaiting_address",
  "preparing",
  "on_the_way",
];

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
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Deliveries"
        description="Doorstep gifts not yet delivered. Partners work these from their own link; step in when they confirm by phone instead, or when one needs moving."
      />

      {deliveries.length === 0 && (
        <EmptyState
          title="Nothing out for delivery"
          body="Hampers, groceries and flowers appear here from the moment they’re paid for."
        />
      )}

      {STAGE_ORDER.map((stage) => {
        const rows = deliveries.filter((d) => d.stage === stage);
        if (rows.length === 0) return null;
        return (
          <Card
            key={stage}
            title={
              <span className="flex items-center gap-2">
                {DELIVERY_STAGE_LABEL[stage]}
                <Pill tone={stage === "needs_vendor" ? "red" : "grey"}>{rows.length}</Pill>
              </span>
            }
            flush
          >
            <ul className="divide-y divide-zinc-100">
              {rows.map((d) => {
                const waitedMin = minutesSince(d.waitingSince);
                const late = d.late && stage !== "needs_vendor";
                return (
                  <li key={d.orderId} className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
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
          </Card>
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
