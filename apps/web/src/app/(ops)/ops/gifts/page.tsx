import type { Metadata } from "next";
import Link from "next/link";
import { GIFT_CATEGORY_LABEL } from "@ebun/types";
import { ButtonLink, Card, EmptyState, PageHeader, Pill } from "@/components/ops/ui";
import { formatNaira } from "@/lib/format-money";
import { opsFetch } from "@/lib/ops/api";
import { NOT_LIVE_REASON, type GiftTemplate } from "@/lib/ops/types";
import { AvailabilityToggle } from "./availability-toggle";

export const metadata: Metadata = { title: "Gifts" };

const CATEGORY_LABEL: Record<string, string> = GIFT_CATEGORY_LABEL;

const HOW: Record<GiftTemplate["deliveryType"], string> = {
  digital_voucher: "Collected",
  physical: "Delivered",
  vtu: "To their phone",
  experience: "Experience",
};

type Show = "all" | "live" | "attention" | "off";

const TABS: { key: Show; label: string }[] = [
  { key: "all", label: "All" },
  { key: "live", label: "Live" },
  { key: "attention", label: "On sale but hidden" },
  { key: "off", label: "Off sale" },
];

/** On sale, but nobody can buy it — the state that used to look identical to "live". */
const needsAttention = (gift: GiftTemplate) => gift.available && !gift.live;

/**
 * The catalogue, organised around the one question that matters: can a
 * sender buy this right now? A gift is live when it's on sale AND a
 * partner makes it. "On sale but hidden" is its own tab so a gift with
 * no partner can't hide in a list of green "On sale" badges.
 */
export default async function GiftsPage({ searchParams }: PageProps<"/ops/gifts">) {
  const sp = await searchParams;
  const show = (TABS.some((t) => t.key === sp.show) ? sp.show : "all") as Show;
  const gifts = await opsFetch<GiftTemplate[]>("/ops/gifts");

  const counts: Record<Show, number> = {
    all: gifts.length,
    live: gifts.filter((g) => g.live).length,
    attention: gifts.filter(needsAttention).length,
    off: gifts.filter((g) => !g.available).length,
  };
  const visible = gifts.filter((g) =>
    show === "live" ? g.live : show === "attention" ? needsAttention(g) : show === "off" ? !g.available : true,
  );

  return (
    <>
      <PageHeader
        title="Gifts"
        description={`${counts.live} live on /send · ${gifts.length} in total`}
        actions={<ButtonLink href="/ops/gifts/new">Add gift</ButtonLink>}
      />

      <p className="mb-4 text-zinc-600">
        A gift is <span className="font-medium text-zinc-900">live</span> when it&rsquo;s on sale{" "}
        <span className="font-medium text-zinc-900">and</span> a partner makes it. Open a gift to add its partner,
        photo and price.
      </p>

      <nav className="mb-4 flex gap-1 overflow-x-auto [scrollbar-width:none]" aria-label="Filter gifts">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            href={tab.key === "all" ? "/ops/gifts" : `/ops/gifts?show=${tab.key}`}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 whitespace-nowrap ${
              show === tab.key ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-200/60"
            }`}
          >
            {tab.label}
            <span
              className={`rounded-full px-1.5 text-xs tabular-nums ${
                show === tab.key
                  ? "bg-white/20"
                  : tab.key === "attention" && counts.attention > 0
                    ? "bg-amber-100 text-amber-900"
                    : "bg-zinc-200"
              }`}
            >
              {counts[tab.key]}
            </span>
          </Link>
        ))}
      </nav>

      {gifts.length === 0 ? (
        <EmptyState
          title="No gifts yet"
          body="Add what your partners make. Nothing can be sent until at least one gift is live."
          action={<ButtonLink href="/ops/gifts/new">Add gift</ButtonLink>}
        />
      ) : visible.length === 0 ? (
        <EmptyState title="Nothing here" body="No gifts match this filter." />
      ) : (
        <Card flush>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead className="border-b border-zinc-100 bg-zinc-50/60 text-xs tracking-wide text-zinc-500 uppercase">
                <tr>
                  <th className="px-5 py-3 font-medium">Gift</th>
                  <th className="px-5 py-3 font-medium">Price</th>
                  <th className="px-5 py-3 font-medium">How</th>
                  <th className="px-5 py-3 font-medium">Made by</th>
                  <th className="px-5 py-3 font-medium">On /send</th>
                  <th className="px-5 py-3 font-medium">On sale</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {visible.map((gift) => (
                  <tr key={gift.id} className="hover:bg-zinc-50">
                    <td className="px-5 py-3">
                      <Link href={`/ops/gifts/${gift.id}`} className="group flex items-center gap-3">
                        {gift.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element -- R2 public URL
                          <img src={gift.imageUrl} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover ring-1 ring-zinc-200" />
                        ) : (
                          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-[10px] text-zinc-500">
                            No photo
                          </span>
                        )}
                        <span className="min-w-0">
                          <span className="block font-medium text-zinc-900 group-hover:underline">{gift.name}</span>
                          <span className="block text-zinc-500">{CATEGORY_LABEL[gift.category] ?? gift.category}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-5 py-3 tabular-nums">{formatNaira(gift.basePrice)}</td>
                    <td className="px-5 py-3 text-zinc-600">{HOW[gift.deliveryType] ?? gift.deliveryType}</td>
                    <td className="px-5 py-3">
                      {gift.sellers.length === 0 ? (
                        <span className="text-amber-700">Nobody yet</span>
                      ) : (
                        <span className="text-zinc-700">
                          {gift.sellers.map((s) => s.vendorName).join(", ")}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {gift.live ? (
                        <Pill tone="green">Live</Pill>
                      ) : gift.notLiveBecause === "off_sale" ? (
                        <Pill tone="grey">Hidden</Pill>
                      ) : (
                        <Pill tone="amber">{NOT_LIVE_REASON[gift.notLiveBecause ?? "off_sale"]}</Pill>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <AvailabilityToggle id={gift.id} name={gift.name} available={gift.available} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
