"use client";

import { useMemo, useState } from "react";
import { FulfillmentType } from "@ebun/types";
import { formatNaira } from "@/lib/format-money";
import type { GiftCatalogItem } from "@/lib/gifts/types";

const CATEGORY_LABEL: Record<GiftCatalogItem["category"], string> = {
  food: "Food & drink",
  experience: "Experiences",
  keepsake: "Keepsakes",
  utility: "Airtime & bills",
};

/**
 * The entry point, and the hook.
 *
 * Replaces the old two-tap pattern (select a card, then press
 * "Personalise" on a sticky bar) with one: tapping a gift IS choosing
 * it. The sticky bar existed to confirm a selection the sender had
 * already made by tapping, which is a tap spent on nothing — and the
 * gift is shown again, with a way back, on the very next screen, so
 * nothing is lost by moving straight on.
 *
 * Cards are built to work with no photograph, because today there are
 * none. A card that leans on an image looks broken without one; this
 * one leads with the gift's name in display type and treats the image,
 * when it arrives, as reinforcement rather than the subject.
 */
export function GiftPicker({
  catalog,
  catalogReachable,
  onChoose,
}: {
  catalog: GiftCatalogItem[];
  catalogReachable: boolean;
  onChoose: (gift: GiftCatalogItem) => void;
}) {
  const [category, setCategory] = useState<GiftCatalogItem["category"] | "all">("all");

  const categories = useMemo(
    () => [...new Set(catalog.map((item) => item.category))] as GiftCatalogItem["category"][],
    [catalog],
  );
  const visible =
    category === "all" ? catalog : catalog.filter((item) => item.category === category);

  return (
    <>
      <div className="pb-6">
        <h1 className="font-display text-3xl leading-tight font-normal" style={{ color: "var(--cream)" }}>
          What are you sending?
        </h1>
        <p className="mt-2 text-sm" style={{ color: "var(--cream-dim)" }}>
          Pick one. You&rsquo;ll add your message next.
        </p>
      </div>

      {categories.length > 1 && (
        <div className="mb-5 flex gap-2 overflow-x-auto pb-1" aria-label="Gift categories">
          <CategoryChip active={category === "all"} onClick={() => setCategory("all")}>
            Everything
          </CategoryChip>
          {categories.map((item) => (
            <CategoryChip
              key={item}
              active={category === item}
              onClick={() => setCategory(item)}
            >
              {CATEGORY_LABEL[item]}
            </CategoryChip>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-3 pb-12">
        {catalog.length === 0 && (
          <div
            className="border p-6 text-center text-sm leading-relaxed"
            style={{ borderColor: "var(--border)", color: "var(--cream-dim)" }}
          >
            {/*
              Two different problems with two different fixes. Telling
              someone to check their connection when the real answer is
              that nothing is on sale sends them chasing a fault that
              isn't theirs — and hides, from whoever is debugging, the
              one state they most need to see.
            */}
            {catalogReachable
              ? "There's nothing to send just yet. We're adding gifts — check back shortly."
              : "The gift list didn't load. Check your connection and reload the page."}
          </div>
        )}

        {visible.map((item) => (
          <GiftCard key={item.id} item={item} onChoose={() => onChoose(item)} />
        ))}
      </div>
    </>
  );
}

function CategoryChip({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="shrink-0 border px-3.5 py-2 text-xs transition-colors"
      style={{
        borderColor: active ? "var(--gold)" : "var(--border)",
        background: active ? "var(--gold-glow)" : "transparent",
        color: active ? "var(--gold-light)" : "var(--cream-dim)",
      }}
    >
      {children}
    </button>
  );
}

/**
 * How the recipient actually gets it, in their words.
 *
 * Each fulfillment type is genuinely different and a sender choosing
 * between them needs to know which: a voucher is collected in person, a
 * top-up just arrives, a physical gift is delivered. Lumping VTU in
 * with vouchers told a sender buying airtime that someone would have to
 * walk into a shop for it.
 */
function describeCollection(item: GiftCatalogItem): string {
  switch (item.deliveryType) {
    case FulfillmentType.Physical:
      return item.deliveryWindow ? `Delivered in ${item.deliveryWindow}` : "Delivered";
    case FulfillmentType.Vtu:
      return "Sent to their line in seconds";
    default:
      return "Collected in person";
  }
}

function GiftCard({
  item,
  onChoose,
}: {
  item: GiftCatalogItem;
  onChoose: () => void;
}) {
  const collection = describeCollection(item);

  return (
    <button
      type="button"
      onClick={onChoose}
      className="flex w-full gap-4 border p-4 text-left transition-colors duration-150 hover:border-[color:var(--border-strong)]"
      style={{ borderColor: "var(--border)", background: "var(--panel)" }}
    >
      {/*
        No placeholder frame when there is no photograph. An empty
        bordered square repeated down the list reads as an image that
        failed to load; without it the card is simply type-led, which
        looks like a decision rather than a gap. The catalogue has no
        images today, so this is the state that actually ships.
      */}
      {item.imageUrl && (
        <div
          className="h-20 w-20 shrink-0 overflow-hidden border"
          style={{ borderColor: "var(--border)", background: "var(--panel-raised)" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- catalog images are remote URLs */}
          <img src={item.imageUrl} alt="" className="h-full w-full object-cover" />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <h2 className="font-display text-xl leading-tight" style={{ color: "var(--cream)" }}>
          {item.name}
        </h2>
        {item.description && (
          <p
            className="mt-1.5 text-xs leading-relaxed"
            style={{ color: "var(--cream-dim)" }}
          >
            {item.description}
          </p>
        )}
        <div className="mt-3 flex items-baseline gap-3">
          <span className="text-sm" style={{ color: "var(--gold-light)" }}>
            {formatNaira(item.basePrice)}
          </span>
          <span className="text-[11px]" style={{ color: "var(--cream-faint)" }}>
            {collection}
          </span>
        </div>
      </div>
    </button>
  );
}
