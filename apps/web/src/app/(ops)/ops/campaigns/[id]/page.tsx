import Link from "next/link";
import { Card, PageHeader, Pill, StatCard } from "@/components/ops/ui";
import { formatNaira } from "@/lib/format-money";
import { opsFetch } from "@/lib/ops/api";
import type { OpsCampaign } from "@/lib/ops/types";
import type { CampaignReport } from "@/lib/company/api";
import { CAMPAIGN_STATUS } from "../status";
import { CampaignControls } from "./campaign-controls";

export default async function CampaignPage({ params }: PageProps<"/ops/campaigns/[id]">) {
  const { id } = await params;
  const campaign = await opsFetch<OpsCampaign>(`/ops/campaigns/${id}`);
  const report = campaign.status === "paid" ? await opsFetch<CampaignReport>(`/ops/campaigns/${id}/report`) : null;
  const status = CAMPAIGN_STATUS[campaign.status];

  return (
    <>
      <Link href="/ops/campaigns" className="mb-3 inline-block text-zinc-600 hover:text-zinc-900">
        ← Campaigns
      </Link>
      <PageHeader
        title={campaign.companyName}
        description={
          <>
            {campaign.title} · <Pill tone={status.tone}>{status.label}</Pill>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-4">
          {report ? (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatCard label="People" value={report.totals.people} />
                <StatCard label="Opened" value={report.totals.opened + report.totals.on_its_way + report.totals.used} />
                <StatCard label="Enjoyed" value={report.totals.used} />
                <StatCard label="Credit due" value={formatNaira(report.money.creditDue)} hint="Owed back to the company" />
              </div>
              <Card title="Thank-you notes">
                {report.thanks.length === 0 ? (
                  <p className="text-zinc-500">None yet.</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {report.thanks.slice(0, 20).map((n) => (
                      <li key={`${n.name}-${n.at}`}>
                        &ldquo;{n.note}&rdquo; <span className="text-zinc-500">— {n.name}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              {(report.totals.problem > 0 || report.rows.some((r) => r.linkSendError && !r.linkSentAt)) && (
                <Card title="Needs a look">
                  <ul className="list-disc pl-5">
                    {report.totals.problem > 0 && <li>{report.totals.problem} gifts hit a fulfilment problem — see Orders.</li>}
                    {report.rows.filter((r) => r.linkSendError && !r.linkSentAt).length > 0 && (
                      <li>
                        {report.rows.filter((r) => r.linkSendError && !r.linkSentAt).length} emails didn&rsquo;t go
                        out. The company can retry or share from their link sheet.
                      </li>
                    )}
                  </ul>
                </Card>
              )}
            </>
          ) : (
            <Card title="Setup">
              <dl className="grid grid-cols-[160px_1fr] gap-y-2">
                <dt className="text-zinc-500">Gifts</dt>
                <dd>{campaign.options.map((o) => o.name).join(", ") || "Not chosen"}</dd>
                <dt className="text-zinc-500">People</dt>
                <dd>{campaign.recipientsCount}</dd>
                <dt className="text-zinc-500">Message</dt>
                <dd>{campaign.message.type === "text" ? (campaign.message.text ? "Written" : "Not yet") : `Recorded ${campaign.message.type}`}</dd>
                <dt className="text-zinc-500">Sends</dt>
                <dd>
                  {campaign.sendAt
                    ? new Date(campaign.sendAt).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })
                    : "As soon as it's paid"}
                </dd>
                <dt className="text-zinc-500">Still to do</dt>
                <dd>{campaign.missing.length > 0 ? campaign.missing.join(" ") : "Ready to pay"}</dd>
              </dl>
            </Card>
          )}

          {campaign.quote && (
            <Card title={campaign.status === "draft" ? "Quote (live)" : "Charged"}>
              <dl className="grid max-w-sm grid-cols-[1fr_auto] gap-y-1.5">
                <dt className="text-zinc-600">
                  {campaign.quote.recipients} × {formatNaira(campaign.quote.seatPrice)}
                </dt>
                <dd className="text-right tabular-nums">{formatNaira(campaign.quote.giftTotal)}</dd>
                <dt className="text-zinc-600">Fee ({campaign.quote.feeBps / 100}%)</dt>
                <dd className="text-right tabular-nums">{formatNaira(campaign.quote.fee)}</dd>
                <dt className="font-semibold">Total</dt>
                <dd className="text-right font-semibold tabular-nums">{formatNaira(campaign.quote.amountDue)}</dd>
              </dl>
            </Card>
          )}
        </div>

        <CampaignControls campaign={campaign} />
      </div>
    </>
  );
}
