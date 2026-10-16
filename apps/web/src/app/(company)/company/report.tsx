"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatNaira } from "@/lib/format-money";
import type { Campaign, CampaignReport, RecipientStage } from "@/lib/company/api";
import { resendAction } from "./actions";

const STAGE: Record<RecipientStage, { label: string; tone: string }> = {
  not_paid: { label: "Not paid", tone: "bg-zinc-100 text-zinc-700" },
  waiting: { label: "Not sent yet", tone: "bg-zinc-100 text-zinc-700" },
  sent: { label: "Sent", tone: "bg-sky-50 text-sky-800" },
  opened: { label: "Opened", tone: "bg-violet-50 text-violet-800" },
  on_its_way: { label: "On its way", tone: "bg-amber-50 text-amber-900" },
  used: { label: "Enjoyed", tone: "bg-emerald-50 text-emerald-800" },
  expired: { label: "Unclaimed", tone: "bg-zinc-100 text-zinc-500" },
  refunded: { label: "Refunded", tone: "bg-zinc-100 text-zinc-500" },
  problem: { label: "We're on it", tone: "bg-red-50 text-red-800" },
};

/**
 * After payment: who got their gift, who opened it, who used it, and
 * what they said. The thank-you notes are the part HR will screenshot;
 * the money panel is what finance will ask about.
 */
export function CampaignReportView({ campaign, report }: { campaign: Campaign; report: CampaignReport }) {
  const router = useRouter();
  const [filter, setFilter] = useState<RecipientStage | "all">("all");
  const [notice, setNotice] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const t = report.totals;
  const reached = t.sent + t.opened + t.on_its_way + t.used;
  const rows = useMemo(
    () => (filter === "all" ? report.rows : report.rows.filter((r) => r.stage === filter)),
    [filter, report.rows],
  );
  const failedEmails = report.rows.filter((r) => r.linkSendError && !r.linkSentAt).length;
  const scheduled = campaign.sendAt && !campaign.linksSentAt && new Date(campaign.sendAt) > new Date();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">{campaign.companyName}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{campaign.title}</h1>
          <p className="mt-1 text-zinc-600">
            {scheduled
              ? `Paid. Links go out ${new Date(campaign.sendAt as string).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}.`
              : campaign.linksSentAt
                ? `Sent ${new Date(campaign.linksSentAt).toLocaleDateString("en-NG", { dateStyle: "medium" })}.`
                : "Paid. Links are going out now."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href="/company/links.csv"
            className="rounded-lg border border-zinc-300 bg-white px-4 py-2 font-medium text-zinc-800 shadow-sm hover:bg-zinc-50"
          >
            Download link sheet
          </a>
          {failedEmails > 0 && (
            <button
              type="button"
              disabled={pending}
              className="rounded-lg bg-zinc-900 px-4 py-2 font-medium text-white shadow-sm disabled:opacity-50"
              onClick={() =>
                start(async () => {
                  setErrors([]);
                  const res = await resendAction();
                  if (!res.ok) setErrors(res.errors);
                  else {
                    setNotice(`Emailed ${res.data.emailed}. ${res.data.failed > 0 ? `${res.data.failed} still failing.` : ""}`);
                    router.refresh();
                  }
                })
              }
            >
              {pending ? "Sending…" : `Retry ${failedEmails} failed ${failedEmails === 1 ? "email" : "emails"}`}
            </button>
          )}
        </div>
      </div>

      <p className="text-xs text-zinc-500">
        The link sheet has everyone&rsquo;s personal link — share it over WhatsApp or your own email for anyone without an
        email address. Each link is for one person only.
      </p>
      {notice && <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-emerald-900">{notice}</p>}
      {errors.length > 0 && <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-red-800">{errors.join(" ")}</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="People" value={t.people} />
        <Stat label="Reached" value={reached} hint={t.waiting > 0 ? `${t.waiting} not sent yet` : undefined} />
        <Stat label="Opened" value={t.opened + t.on_its_way + t.used} />
        <Stat label="Enjoyed" value={t.used} />
        <Stat label="Said thanks" value={t.thanked} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-5 py-3.5">
            <h2 className="font-semibold">Everyone</h2>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as RecipientStage | "all")}
              className="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs"
            >
              <option value="all">All ({t.people})</option>
              {(Object.keys(STAGE) as RecipientStage[])
                .filter((s) => t[s] > 0)
                .map((s) => (
                  <option key={s} value={s}>
                    {STAGE[s].label} ({t[s]})
                  </option>
                ))}
            </select>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left">
              <thead className="bg-zinc-50 text-xs text-zinc-500 uppercase">
                <tr>
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Gift</th>
                  <th className="px-4 py-2 font-medium">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {rows.map((r) => (
                  <tr key={r.recipientId}>
                    <td className="px-4 py-2.5">
                      <p className="font-medium">{r.name}</p>
                      {r.linkSendError && !r.linkSentAt && (
                        <p className="text-xs text-red-700">Email didn&rsquo;t go — share from the link sheet.</p>
                      )}
                      {!r.email && r.stage === "waiting" && campaign.linksSentAt && (
                        <p className="text-xs text-amber-800">No email — share from the link sheet.</p>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${STAGE[r.stage].tone}`}>
                        {STAGE[r.stage].label}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-zinc-700">
                      {r.giftName ?? (r.choosing ? <span className="text-zinc-400">Choosing</span> : "—")}
                    </td>
                    <td className="px-4 py-2.5 text-zinc-600">{r.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="flex flex-col gap-4">
          <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
            <h2 className="font-semibold">Thank-you notes</h2>
            {report.thanks.length === 0 ? (
              <p className="mt-2 text-zinc-500">Notes people send back appear here.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-3">
                {report.thanks.map((n) => (
                  <li key={`${n.name}-${n.at}`} className="rounded-lg bg-stone-50 px-3 py-2.5">
                    <p className="text-zinc-800">&ldquo;{n.note}&rdquo;</p>
                    <p className="mt-1 text-xs text-zinc-500">— {n.name}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {report.choices.length > 1 && (
            <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
              <h2 className="font-semibold">What people chose</h2>
              <ul className="mt-2 flex flex-col gap-1.5">
                {report.choices.map((c) => (
                  <li key={c.giftTemplateId} className="flex justify-between">
                    <span>{c.name}</span>
                    <span className="tabular-nums">{c.count}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
            <h2 className="font-semibold">Money</h2>
            <dl className="mt-2 grid grid-cols-[1fr_auto] gap-y-1.5">
              <dt className="text-zinc-600">Gifts paid for</dt>
              <dd className="text-right tabular-nums">{formatNaira(report.money.paid)}</dd>
              <dt className="text-zinc-600">Enjoyed so far</dt>
              <dd className="text-right tabular-nums">{formatNaira(report.money.used)}</dd>
              <dt className="text-zinc-600">Credit due to you</dt>
              <dd className="text-right font-semibold tabular-nums">{formatNaira(report.money.creditDue)}</dd>
            </dl>
            <p className="mt-2 text-xs text-zinc-500">
              Unclaimed gifts and the difference on cheaper choices, credited to your next campaign.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}
