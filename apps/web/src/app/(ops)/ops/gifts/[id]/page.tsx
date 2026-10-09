import Link from "next/link";
import { notFound } from "next/navigation";
import { OpsApiError, opsFetch } from "@/lib/ops/api";
import type { GiftTemplate } from "@/lib/ops/types";
import { GiftForm } from "../gift-form";

export default async function GiftDetailPage({
  params,
  searchParams,
}: PageProps<"/ops/gifts/[id]">) {
  const { id } = await params;
  const query = await searchParams;

  let gift: GiftTemplate;
  try {
    gift = await opsFetch<GiftTemplate>(`/ops/gifts/${id}`);
  } catch (error) {
    // 404 (unknown id) and 400 (malformed id) both mean "no such gift".
    if (error instanceof OpsApiError && (error.status === 404 || error.status === 400)) {
      notFound();
    }
    throw error;
  }

  return (
    <>
      <Link href="/ops/gifts" className="mb-3 inline-block text-zinc-600 hover:text-zinc-900">
        ← Gifts
      </Link>
      <h1 className="mb-1 text-lg font-semibold">{gift.name}</h1>
      <p className="mb-6 text-zinc-600">
        {gift.available ? "On sale now." : "Not on sale — senders can't see this."}
      </p>

      {query.created === "1" && (
        <p className="mb-6 rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-emerald-900">
          Gift added. Put it on sale below when the price is right, then link a vendor to it from
          their page.
        </p>
      )}

      <GiftForm gift={gift} />
    </>
  );
}
