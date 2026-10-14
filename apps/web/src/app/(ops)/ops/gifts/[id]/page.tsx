import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GIFT_CATEGORY_LABEL } from "@ebun/types";
import { PageHeader, Pill } from "@/components/ops/ui";
import { formatNaira } from "@/lib/format-money";
import { OpsApiError, opsFetch } from "@/lib/ops/api";
import { DELIVERY_TYPE_LABEL, NOT_LIVE_REASON, type GiftTemplate } from "@/lib/ops/types";
import { GiftForm } from "../gift-form";
import { activePartners } from "../partners";
import { DeleteGiftCard, GiftPhotoCard, GiftSellersPanel, GiftStatusCard } from "./gift-panels";

export const metadata: Metadata = { title: "Gift" };

/**
 * Everything about one gift on one screen: whether senders can buy it
 * (and why not), its photo, who makes it and what they're paid, and the
 * details. Each side panel saves on its own with its own feedback; the
 * details form saves only its own fields.
 */
export default async function GiftDetailPage({ params }: PageProps<"/ops/gifts/[id]">) {
  const { id } = await params;

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
  const partners = await activePartners();
  const categoryLabel: Record<string, string> = GIFT_CATEGORY_LABEL;

  return (
    <>
      <Link href="/ops/gifts" className="mb-3 inline-block text-zinc-600 hover:text-zinc-900">
        ← Gifts
      </Link>
      <PageHeader
        title={gift.name}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {gift.live ? (
              <Pill tone="green">Live on /send</Pill>
            ) : (
              <Pill tone={gift.notLiveBecause === "off_sale" ? "grey" : "amber"}>
                Hidden · {NOT_LIVE_REASON[gift.notLiveBecause ?? "off_sale"]}
              </Pill>
            )}
            <span>{formatNaira(gift.basePrice)}</span>
            <span>{categoryLabel[gift.category] ?? gift.category}</span>
            <span>{DELIVERY_TYPE_LABEL[gift.deliveryType]}</span>
          </span>
        }
      />

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:order-2">
          <GiftStatusCard gift={gift} />
          <GiftSellersPanel gift={gift} partners={partners} />
          <GiftPhotoCard gift={gift} />
          <DeleteGiftCard gift={gift} />
        </div>
        <div className="lg:order-1 lg:col-span-2">
          {/* Keyed on updatedAt: after any save the form remounts with
              the server's values, so it can never show (or re-send)
              something stale. */}
          <GiftForm key={gift.updatedAt} gift={gift} />
        </div>
      </div>
    </>
  );
}
