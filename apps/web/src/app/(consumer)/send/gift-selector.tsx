"use client";

import { useState } from "react";
import { FulfillmentType } from "@ebun/types";
import { GiftMark } from "@/components/icons";
import { formatNaira } from "@/lib/format-money";
import type { GiftCatalogItem } from "@/lib/gifts/types";

/**
 * First of the sender flow's phases (see the Product Brief: choose
 * occasion -> pick a gift -> personalise -> pay). Occasion selection is
 * deliberately skipped — it doesn't gate anything downstream and adds
 * a screen before there's anywhere for it to lead.
 */
export function GiftSelector({
  catalog,
  initialSelectedId,
  onContinue,
}: {
  catalog: GiftCatalogItem[];
  initialSelectedId: string | null;
  onContinue: (gift: GiftCatalogItem) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const selected = catalog.find((item) => item.id === selectedId) ?? null;

  return (
    <>
      <div className="flex flex-col gap-1.5 pb-6 text-center">
        <h1 className="font-display text-3xl font-normal" style={{ color: "var(--cream)" }}>
          What are you sending?
        </h1>
        <p className="text-sm" style={{ color: "var(--cream-dim)" }}>
          Every gift comes with a message attached.
        </p>
      </div>

      <div className={selected ? "pb-32" : "pb-10"}>
        {catalog.map((item) => (
          <GiftRow
            key={item.id}
            item={item}
            selected={item.id === selectedId}
            onSelect={() => setSelectedId(item.id)}
          />
        ))}
      </div>

      {selected && (
        <div
          className="fixed inset-x-0 bottom-0 border-t px-7 pt-4"
          style={{
            borderColor: "var(--border)",
            background: "rgba(14, 13, 11, 0.95)",
            paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1.25rem)",
          }}
        >
          <div className="mx-auto flex max-w-[440px] items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] tracking-wide" style={{ color: "var(--cream-dim)" }}>
                Selected
              </p>
              <p className="font-display truncate text-lg" style={{ color: "var(--cream)" }}>
                {selected.name}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onContinue(selected)}
              className="flex-shrink-0 px-6 py-3 text-sm font-medium tracking-wide"
              style={{ background: "var(--gold)", color: "var(--ink)" }}
            >
              Continue
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function GiftRow({
  item,
  selected,
  onSelect,
}: {
  item: GiftCatalogItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const journeyLabel =
    item.deliveryType === FulfillmentType.Physical ? "Delivered" : "Pickup";

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className="flex w-full items-start gap-4 border-b py-5 text-left"
      style={{ borderColor: "var(--border)" }}
    >
      <div
        className="flex h-20 w-20 flex-shrink-0 items-center justify-center border"
        style={{
          borderColor: selected ? "var(--gold)" : "var(--border)",
          background: "var(--panel-raised)",
        }}
      >
        {item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- mock data only; swap for next/image once real R2/CDN URLs exist
          <img src={item.imageUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <GiftMark className="h-8 w-8 text-[color:var(--gold-dim)]" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="font-display min-w-0 truncate text-xl" style={{ color: "var(--cream)" }}>
            {item.name}
          </h3>
          <span
            className="flex-shrink-0 text-sm"
            style={{ color: "var(--gold-light)" }}
          >
            {formatNaira(item.basePrice)}
          </span>
        </div>
        {item.description && (
          <p
            className="mt-1 text-xs leading-relaxed"
            style={{ color: "var(--cream-dim)" }}
          >
            {item.description}
          </p>
        )}
        <p
          className="mt-2 text-[10px] tracking-wide uppercase"
          style={{ color: "var(--gold-dim)" }}
        >
          {journeyLabel}
          {item.deliveryWindow ? ` · ${item.deliveryWindow}` : ""}
        </p>
      </div>

      <div
        className="mt-1.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border"
        style={{ borderColor: selected ? "var(--gold)" : "var(--border-strong)" }}
      >
        {selected && (
          <span className="h-2 w-2 rounded-full" style={{ background: "var(--gold)" }} />
        )}
      </div>
    </button>
  );
}
