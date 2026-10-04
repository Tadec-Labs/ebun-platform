"use client";

import { useMemo, useState } from "react";
import { FulfillmentType } from "@ebun/types";
import { GiftMark } from "@/components/icons";
import { formatNaira } from "@/lib/format-money";
import type { GiftCatalogItem } from "@/lib/gifts/types";

const CATEGORY_LABEL: Record<GiftCatalogItem["category"], string> = {
  food: "Food & drink",
  experience: "Experiences",
  keepsake: "Keepsakes",
  utility: "Utility",
};

/**
 * Second phase of the sender flow. Filtering and selection are purely
 * local display state; the selected catalog item is still passed through
 * unchanged to the existing message and payment steps.
 */
export function GiftSelector({
  catalog,
  initialSelectedId,
  onContinue,
  onBack,
}: {
  catalog: GiftCatalogItem[];
  initialSelectedId: string | null;
  onContinue: (gift: GiftCatalogItem) => void;
  onBack: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [category, setCategory] = useState<GiftCatalogItem["category"] | "all">("all");

  const categories = useMemo(
    () => [...new Set(catalog.map((item) => item.category))] as GiftCatalogItem["category"][],
    [catalog],
  );
  const visibleCatalog =
    category === "all" ? catalog : catalog.filter((item) => item.category === category);
  const selected = catalog.find((item) => item.id === selectedId) ?? null;

  return (
    <>
      <button
        type="button"
        onClick={onBack}
        className="mb-5 self-start text-xs tracking-wide transition-colors hover:text-[color:var(--cream)]"
        style={{ color: "var(--cream-dim)" }}
      >
        ← Occasion
      </button>

      <div className="pb-5">
        <h1 className="font-display text-3xl font-normal" style={{ color: "var(--cream)" }}>
          Choose a gift
        </h1>
        <p className="mt-2 text-sm" style={{ color: "var(--cream-dim)" }}>
          Thoughtful options, ready to make their day.
        </p>
      </div>

      {categories.length > 1 && (
        <div className="mb-4 flex gap-2 overflow-x-auto pb-1" aria-label="Gift categories">
          <CategoryButton active={category === "all"} onClick={() => setCategory("all")}>
            All gifts
          </CategoryButton>
          {categories.map((itemCategory) => (
            <CategoryButton
              key={itemCategory}
              active={category === itemCategory}
              onClick={() => setCategory(itemCategory)}
            >
              {CATEGORY_LABEL[itemCategory]}
            </CategoryButton>
          ))}
        </div>
      )}

      <div className={selected ? "flex flex-col gap-3 pb-32" : "flex flex-col gap-3 pb-10"}>
        {catalog.length === 0 && (
          <div
            className="border p-5 text-center text-sm leading-relaxed"
            style={{ borderColor: "var(--border)", color: "var(--cream-dim)" }}
          >
            Couldn&rsquo;t load the gift catalogue right now. Check your connection and reload the
            page.
          </div>
        )}

        {visibleCatalog.map((item) => (
          <GiftCard
            key={item.id}
            item={item}
            selected={item.id === selectedId}
            onSelect={() => setSelectedId(item.id)}
          />
        ))}
      </div>

      {selected && (
        <div
          className="fixed inset-x-0 bottom-0 z-10 border-t px-7 pt-3"
          style={{
            borderColor: "var(--border)",
            background: "rgba(14, 13, 11, 0.96)",
            backdropFilter: "blur(16px)",
            paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)",
          }}
        >
          <div className="mx-auto flex max-w-[440px] items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="truncate text-sm" style={{ color: "var(--cream)" }}>
                {selected.name}
              </p>
              <p className="mt-0.5 text-xs" style={{ color: "var(--gold-light)" }}>
                {formatNaira(selected.basePrice)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onContinue(selected)}
              className="min-h-12 shrink-0 px-5 text-sm font-semibold transition-colors hover:bg-[color:var(--gold-light)]"
              style={{ background: "var(--gold)", color: "var(--ink)" }}
            >
              Personalise <span aria-hidden="true">→</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function CategoryButton({
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
      className="shrink-0 border px-3 py-2 text-xs transition-colors"
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

function GiftCard({
  item,
  selected,
  onSelect,
}: {
  item: GiftCatalogItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const fulfillmentLabel =
    item.deliveryType === FulfillmentType.Physical ? "Delivered" : "Redeem in person";

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className="relative flex w-full gap-4 border p-3 text-left transition-[border-color,background-color] duration-150"
      style={{
        borderColor: selected ? "var(--gold)" : "var(--border)",
        background: selected ? "var(--gold-glow)" : "var(--panel)",
      }}
    >
      <div
        className="flex h-22 w-22 shrink-0 items-center justify-center border"
        style={{
          borderColor: selected ? "var(--border-strong)" : "var(--border)",
          background: "var(--panel-raised)",
        }}
      >
        {item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- catalog images are remote URLs
          <img src={item.imageUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <GiftMark className="h-8 w-8 text-[color:var(--gold-dim)]" />
        )}
      </div>

      <div className="min-w-0 flex-1 pr-5">
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-xl leading-tight" style={{ color: "var(--cream)" }}>
            {item.name}
          </h2>
          <span className="shrink-0 text-sm" style={{ color: "var(--gold-light)" }}>
            {formatNaira(item.basePrice)}
          </span>
        </div>
        {item.description && (
          <p className="mt-2 text-xs leading-relaxed" style={{ color: "var(--cream-dim)" }}>
            {item.description}
          </p>
        )}
        <p className="mt-3 text-[10px] tracking-[0.12em] uppercase" style={{ color: "var(--gold-dim)" }}>
          {fulfillmentLabel}
          {item.deliveryWindow ? " · " + item.deliveryWindow : ""}
        </p>
      </div>

      <span
        aria-hidden="true"
        className="absolute right-3 top-3 flex h-4 w-4 items-center justify-center rounded-full border"
        style={{
          borderColor: selected ? "var(--gold)" : "var(--border-strong)",
          background: selected ? "var(--gold)" : "transparent",
          color: "var(--ink)",
        }}
      >
        {selected ? "✓" : ""}
      </span>
    </button>
  );
}
