"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/ui/feedback";
import type { OpsCampaign } from "@/lib/ops/types";
import { cancelCampaignAction, rotateCampaignLinkAction, updateCampaignFeeAction } from "../actions";

/**
 * The company's link (shown in full — ops hands it over), the fee, and
 * the two irreversible buttons.
 */
export function CampaignControls({ campaign }: { campaign: OpsCampaign }) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [fee, setFee] = useState(String(campaign.feeBps / 100));
  const [notice, setNotice] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const [ask, dialog] = useConfirm();

  const emailBody = [
    `Hi ${campaign.contactName.split(" ")[0]},`,
    "",
    `Here is your SendEbun link for "${campaign.title}":`,
    campaign.portalUrl,
    "",
    "On it you can upload your list (name, phone, email), record a short message from your CEO or team lead, choose the gift (or up to three for people to pick from), set the send date, and pay once.",
    "After it's paid, the same link shows who opened their gift, who used it, and their thank-you notes.",
    "",
    "Please keep the link within your team — it controls the campaign.",
  ].join("\n");

  function act(run: () => Promise<{ ok: boolean; message?: string; errors?: string[] }>) {
    setErrors([]);
    setNotice(null);
    start(async () => {
      const result = await run();
      if (result.ok) {
        setNotice(result.message ?? "Done.");
        router.refresh();
      } else setErrors(result.errors ?? []);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold">Their link</h2>
        <p className="text-zinc-600">
          Everything the company does happens here — set up, pay, follow results. Treat it like a password.
        </p>
        <code className="overflow-x-auto rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs whitespace-nowrap">
          {campaign.portalUrl}
        </code>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg border border-zinc-300 px-3 py-2"
            onClick={() =>
              void navigator.clipboard.writeText(campaign.portalUrl).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              })
            }
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <a
            className="rounded-lg bg-zinc-900 px-3 py-2 font-medium text-white"
            href={`mailto:${campaign.contactEmail}?subject=${encodeURIComponent(`Your SendEbun campaign link`)}&body=${encodeURIComponent(emailBody)}`}
          >
            Email to {campaign.contactName.split(" ")[0]}
          </a>
        </div>
        <p className="text-xs text-zinc-500">
          {campaign.contactName} · {campaign.contactEmail}
          {campaign.contactPhone ? ` · ${campaign.contactPhone}` : ""}
        </p>
      </section>

      {campaign.status === "draft" && (
        <section className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="font-semibold">Fee</h2>
          <div className="flex items-center gap-2">
            <input
              className="w-24 rounded-lg border border-zinc-300 px-3 py-2"
              inputMode="decimal"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
            />
            <span>%</span>
            <button
              type="button"
              disabled={pending}
              className="rounded-lg border border-zinc-300 px-3 py-2 disabled:opacity-50"
              onClick={() => act(() => updateCampaignFeeAction(campaign.id, fee))}
            >
              Save
            </button>
          </div>
          <p className="text-xs text-zinc-500">Locked once they start paying.</p>
        </section>
      )}

      <section className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <button
          type="button"
          disabled={pending || campaign.status === "cancelled"}
          className="rounded-lg border border-zinc-300 px-3 py-2 text-left disabled:opacity-50"
          onClick={async () => {
            const ok = await ask({
              title: "Issue a new link?",
              body: "Their current link stops working at once. Send them the new one.",
              confirmLabel: "Issue new link",
              tone: "danger",
            });
            if (ok) act(() => rotateCampaignLinkAction(campaign.id));
          }}
        >
          Replace their link
        </button>
        {(campaign.status === "draft" || campaign.status === "awaiting_payment") && (
          <button
            type="button"
            disabled={pending}
            className="rounded-lg border border-red-300 px-3 py-2 text-left text-red-700 disabled:opacity-50"
            onClick={async () => {
              const ok = await ask({
                title: "Cancel this campaign?",
                body: "Their link stops working. If they paid a checkout you didn't see confirmed, check Paystack before cancelling.",
                confirmLabel: "Cancel campaign",
                tone: "danger",
              });
              if (ok) act(() => cancelCampaignAction(campaign.id));
            }}
          >
            Cancel campaign
          </button>
        )}
      </section>

      {notice && <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-900">{notice}</p>}
      {errors.length > 0 && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800">{errors.join(" ")}</p>}
      {dialog}
    </div>
  );
}
