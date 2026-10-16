import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink, Card, EmptyState, PageHeader, Pill } from "@/components/ops/ui";
import { formatNaira } from "@/lib/format-money";
import { opsFetch } from "@/lib/ops/api";
import type { CampaignSummary } from "@/lib/ops/types";
import { CAMPAIGN_STATUS } from "./status";

export const metadata: Metadata = { title: "Company campaigns" };

/**
 * Companies sending gifts to their staff, clients or customers. Ops
 * starts one when a company says yes and sends them their link; the
 * company fills in the rest and pays.
 */
export default async function CampaignsPage() {
  const campaigns = await opsFetch<CampaignSummary[]>("/ops/campaigns");
  const paid = campaigns.filter((c) => c.status === "paid");
  const revenue = paid.reduce((sum, c) => sum + (c.amountDue ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Company campaigns"
        description={`${paid.length} paid · ${formatNaira(revenue)} collected`}
        actions={<ButtonLink href="/ops/campaigns/new">New campaign</ButtonLink>}
      />
      {campaigns.length === 0 ? (
        <EmptyState
          title="No campaigns yet"
          body="When a company says yes, start a campaign here and send them their link. They upload their list, record their message, pick the gifts and pay once."
          action={<ButtonLink href="/ops/campaigns/new">New campaign</ButtonLink>}
        />
      ) : (
        <Card flush>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left">
              <thead className="border-b border-zinc-100 bg-zinc-50/60 text-xs tracking-wide text-zinc-500 uppercase">
                <tr>
                  <th className="px-5 py-3 font-medium">Company</th>
                  <th className="px-5 py-3 font-medium">People</th>
                  <th className="px-5 py-3 font-medium">Amount</th>
                  <th className="px-5 py-3 font-medium">Sends</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {campaigns.map((c) => (
                  <tr key={c.id} className="hover:bg-zinc-50">
                    <td className="px-5 py-3.5">
                      <Link href={`/ops/campaigns/${c.id}`} className="font-medium text-zinc-900 hover:underline">
                        {c.companyName}
                      </Link>
                      <p className="text-zinc-500">{c.title}</p>
                    </td>
                    <td className="px-5 py-3.5 tabular-nums">{c.recipients ?? "—"}</td>
                    <td className="px-5 py-3.5 tabular-nums">{c.amountDue !== null ? formatNaira(c.amountDue) : "—"}</td>
                    <td className="px-5 py-3.5 text-zinc-600">
                      {c.sendAt
                        ? new Date(c.sendAt).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })
                        : "When paid"}
                    </td>
                    <td className="px-5 py-3.5">
                      <Pill tone={CAMPAIGN_STATUS[c.status].tone}>{CAMPAIGN_STATUS[c.status].label}</Pill>
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
