import type { Metadata } from "next";
import { Card, EmptyState, PageHeader, Pill } from "@/components/ops/ui";
import { EVENT_COPY } from "@/lib/events/copy";
import type { OpsEventRow } from "@/lib/events/types";
import { formatNaira } from "@/lib/format-money";
import { opsFetch } from "@/lib/ops/api";
import { EventPayoutActions } from "./event-payout-actions";

export const metadata: Metadata = { title: "Events" };

/**
 * Cash gifts at events: whose account to check, and who to pay. Paying
 * is a bank transfer made outside SendEbun, then recorded here with its
 * reference. The API only lets a payout be recorded for a closed event
 * whose host has been verified, once, for exactly what was raised.
 */
export default async function OpsEventsPage() {
  const rows = await opsFetch<OpsEventRow[]>("/ops/events");
  const toVerify = rows.filter((r) => r.status !== "cancelled" && r.accountNumber && !r.verified && r.payoutStatus === "none");
  const toPay = rows.filter((r) => r.readyToPay);

  return (
    <>
      <PageHeader
        title="Events"
        description={
          rows.length === 0
            ? "No events yet."
            : `${toPay.length} ready to pay · ${toVerify.length} payout ${toVerify.length === 1 ? "account" : "accounts"} to check`
        }
      />

      {toVerify.length > 0 && (
        <p className="mb-5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
          Before verifying, check the account name matches the host (resolve the account in Paystack or your bank app),
          and that the event looks real. Changing the account later clears verification.
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState title="No events yet" body="When a host sets up a wedding, birthday or other event, it shows here." />
      ) : (
        <Card flush>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left">
              <thead className="border-b border-zinc-100 bg-zinc-50/60 text-xs tracking-wide text-zinc-500 uppercase">
                <tr>
                  <th className="px-5 py-3 font-medium">Event</th>
                  <th className="px-5 py-3 font-medium">Cash</th>
                  <th className="px-5 py-3 font-medium">Pay to</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {rows.map((row) => (
                  <tr key={row.id} className="align-top hover:bg-zinc-50">
                    <td className="px-5 py-3.5">
                      <a href={`/e/${row.slug}`} target="_blank" rel="noopener noreferrer" className="font-medium text-zinc-900 hover:underline">
                        {row.title}
                      </a>
                      <p className="text-xs text-zinc-500">
                        {EVENT_COPY[row.eventType].label} · {row.eventDate} · host {row.hostName}
                      </p>
                    </td>
                    <td className="px-5 py-3.5 tabular-nums">
                      {formatNaira(row.cashRaised)}
                      <p className="text-xs text-zinc-500">
                        {row.cashCount} {row.cashCount === 1 ? "gift" : "gifts"} · pay {formatNaira(row.payoutDue)}
                      </p>
                    </td>
                    <td className="px-5 py-3.5">
                      {row.accountNumber ? (
                        <>
                          <p className="font-medium text-zinc-900">{row.accountName}</p>
                          <p className="text-xs text-zinc-500 tabular-nums">
                            {row.accountNumber} · bank code {row.bankCode}
                          </p>
                        </>
                      ) : (
                        <span className="text-zinc-400">No account yet</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex flex-wrap gap-1.5">
                        <Pill tone={row.status === "active" ? "blue" : row.status === "closed" ? "grey" : "red"}>
                          {row.status === "active" ? "Giving open" : row.status === "closed" ? "Closed" : "Cancelled"}
                        </Pill>
                        {row.payoutStatus === "paid" ? (
                          <Pill tone="green">Paid</Pill>
                        ) : row.verified ? (
                          <Pill tone="green">Verified</Pill>
                        ) : row.accountNumber ? (
                          <Pill tone="amber">To verify</Pill>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <EventPayoutActions
                        eventId={row.id}
                        canVerify={row.status !== "cancelled" && !!row.accountNumber && !row.verified && row.payoutStatus === "none"}
                        canPay={row.readyToPay}
                        amount={row.payoutDue}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
