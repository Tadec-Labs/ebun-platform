import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ops/ui";
import { GiftForm } from "../gift-form";
import { activePartners } from "../partners";

export const metadata: Metadata = { title: "Add a gift" };

export default async function NewGiftPage() {
  const partners = await activePartners();
  return (
    <>
      <Link href="/ops/gifts" className="mb-3 inline-block text-zinc-600 hover:text-zinc-900">
        ← Gifts
      </Link>
      <PageHeader
        title="Add a gift"
        description="What it is, a photo, and the partner who makes it — all in one go."
      />
      <div className="max-w-3xl">
        <GiftForm partners={partners} />
      </div>
    </>
  );
}
