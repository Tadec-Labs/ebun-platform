import type { CampaignSummary } from "@/lib/ops/types";

export const CAMPAIGN_STATUS: Record<
  CampaignSummary["status"],
  { label: string; tone: "grey" | "amber" | "green" | "red" }
> = {
  draft: { label: "Setting up", tone: "grey" },
  awaiting_payment: { label: "Paying", tone: "amber" },
  paid: { label: "Paid", tone: "green" },
  cancelled: { label: "Cancelled", tone: "red" },
};
