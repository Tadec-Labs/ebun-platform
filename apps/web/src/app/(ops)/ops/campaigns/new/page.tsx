import Link from "next/link";
import { PageHeader } from "@/components/ops/ui";
import { NewCampaignForm } from "./new-campaign-form";

export default function NewCampaignPage() {
  return (
    <>
      <Link href="/ops/campaigns" className="mb-3 inline-block text-zinc-600 hover:text-zinc-900">
        ← Campaigns
      </Link>
      <PageHeader
        title="New company campaign"
        description="Just who they are and the fee you agreed. They do the rest on their own link."
      />
      <NewCampaignForm />
    </>
  );
}
