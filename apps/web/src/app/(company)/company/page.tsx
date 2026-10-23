import Link from "next/link";
import { redirect } from "next/navigation";
import { CompanyApiError, companyFetch } from "@/lib/company/api";
import { getCompanyToken } from "@/lib/company/session";
import { corporateSelfServeEnabled } from "@/lib/feature-flags";
import type {
  Campaign,
  CampaignCatalogueItem,
  CampaignPerson,
  CampaignReport,
} from "@/lib/company/api";
import { CampaignReportView } from "./report";
import { CampaignSetup, ConfirmingPayment } from "./setup";

/**
 * The company's link lands here. One page, three faces: set up and pay;
 * "confirming your payment" while Paystack's webhook catches up; then
 * the report.
 */
export default async function CompanyPage({ searchParams }: PageProps<"/company">) {
  const params = await searchParams;
  // Paystack appends ?reference=… (and trxref) when it sends them back.
  const backFromPaystack = Boolean(params.reference ?? params.trxref);
  const selfServe = corporateSelfServeEnabled();

  // No link opened on this device yet: with self-serve on, this is
  // simply someone arriving at /company — send them to the front door.
  if (selfServe && !(await getCompanyToken())) redirect("/company/start");

  let campaign: Campaign | null;
  try {
    campaign = await companyFetch<Campaign>("");
  } catch (error) {
    if (error instanceof CompanyApiError) return <Problem text={error.messages.join(" ")} />;
    throw error;
  }
  if (!campaign) {
    return (
      <Problem
        title="This link no longer works"
        text={
          selfServe
            ? "If you opened an old link, use the latest one we emailed you."
            : "Ask your contact at SendEbun for a new one. If you opened an old link, use the latest one they sent."
        }
        action={selfServe ? <Link href="/company/start" className="font-medium text-zinc-900 underline underline-offset-2">Email me my links</Link> : null}
      />
    );
  }

  if (campaign.status === "cancelled") {
    return <Problem title="This campaign was cancelled" text="Talk to your contact at SendEbun if that's unexpected." />;
  }

  if (campaign.status === "paid") {
    const report = await companyFetch<CampaignReport>("/report");
    if (!report) return <Problem text="Couldn't load the report. Refresh the page." />;
    return <CampaignReportView campaign={campaign} report={report} />;
  }

  if (campaign.status === "awaiting_payment" && backFromPaystack) {
    return <ConfirmingPayment />;
  }

  const [catalogue, people] = await Promise.all([
    companyFetch<CampaignCatalogueItem[]>("/gifts"),
    companyFetch<CampaignPerson[]>("/people"),
  ]);
  return <CampaignSetup campaign={campaign} catalogue={catalogue ?? []} people={people ?? []} />;
}

function Problem({
  title = "Something went wrong",
  text,
  action = null,
}: {
  title?: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-md rounded-xl border border-zinc-200 bg-white px-6 py-10 text-center shadow-sm">
      <p className="text-lg font-semibold">{title}</p>
      <p className="mt-2 text-zinc-600">{text}</p>
      {action && <p className="mt-4">{action}</p>}
    </div>
  );
}
