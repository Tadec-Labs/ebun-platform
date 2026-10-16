import { CompanyApiError, companyFetch } from "@/lib/company/api";
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
        text="Ask your contact at SendEbun for a new one. If you opened an old link, use the latest one they sent."
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

function Problem({ title = "Something went wrong", text }: { title?: string; text: string }) {
  return (
    <div className="mx-auto max-w-md rounded-xl border border-zinc-200 bg-white px-6 py-10 text-center shadow-sm">
      <p className="text-lg font-semibold">{title}</p>
      <p className="mt-2 text-zinc-600">{text}</p>
    </div>
  );
}
