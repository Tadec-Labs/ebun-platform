import type { Metadata } from "next";
import Link from "next/link";
import { Card, EmptyState, PageHeader, Pill, timeAgo } from "@/components/ops/ui";
import { formatNaira } from "@/lib/format-money";
import { opsFetch } from "@/lib/ops/api";
import type { PayoutRow } from "@/lib/ops/types";

export const metadata: Metadata = { title: "Payouts" };

/**
 * Everyone SendEbun owes, most first, in one list — so paying partners
 * is a routine, not a hunt through vendor pages. Paying happens on the
 * partner's page (their full account details and every unpaid handover
 * are there); this is the queue.
 */
export default async function PayoutsPage() {
  const rows = await opsFetch<PayoutRow[]>("/ops/payouts");
  const total = rows.reduce((sum, row) => sum + row.owed, 0);
  const noBank = rows.filter((row) => !row.bank).length;

  return (
    <>
      <PageHeader
        title="Payouts"
        description={
          rows.length === 0
            ? "Nothing owed right now."
            : `${formatNaira(total)} owed to ${rows.length} ${rows.length === 1 ? "partner" : "partners"}.`
        }
      />

      {noBank > 0 && (
        <p className="mb-5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
          {noBank} {noBank === 1 ? "partner has" : "partners have"} no bank details yet, so can&rsquo;t be paid. They add
          them under Shop on their link, or you can on their page.
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title="All paid up"
          body="When a partner hands over a gift, what they're owed appears here until you record the transfer."
        />
      ) : (
        <Card flush>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left">
              <thead className="border-b border-zinc-100 bg-zinc-50/60 text-xs tracking-wide text-zinc-500 uppercase">
                <tr>
                  <th className="px-5 py-3 font-medium">Partner</th>
                  <th className="px-5 py-3 font-medium">Owed</th>
                  <th className="px-5 py-3 font-medium">Waiting since</th>
                  <th className="px-5 py-3 font-medium">Pay to</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {rows.map((row) => (
                  <tr key={row.vendorId} className="hover:bg-zinc-50">
                    <td className="px-5 py-3.5">
                      <p className="font-medium">{row.name}</p>
                      <p className="text-zinc-500">
                        {row.collections} {row.collections === 1 ? "gift" : "gifts"} handed over
                      </p>
                    </td>
                    <td className="px-5 py-3.5 text-base font-semibold tabular-nums">{formatNaira(row.owed)}</td>
                    <td className="px-5 py-3.5 text-zinc-600">{timeAgo(row.oldestAt)}</td>
                    <td className="px-5 py-3.5">
                      {row.bank ? (
                        <span className="text-zinc-700">
                          {row.bank.bankName ?? "Bank"} ····{row.bank.last4}
                        </span>
                      ) : (
                        <Pill tone="amber">No bank details</Pill>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <Link
                        href={`/ops/vendors/${row.vendorId}#earnings`}
                        className="inline-flex rounded-lg bg-zinc-900 px-3 py-1.5 font-medium text-white hover:bg-zinc-800"
                      >
                        Pay
                      </Link>
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
