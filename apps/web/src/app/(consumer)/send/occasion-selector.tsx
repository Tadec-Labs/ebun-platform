"use client";

import { useState } from "react";
import { OCCASIONS, type OccasionId } from "@/lib/occasions";

/**
 * First phase of the sender flow, per the Product Brief (occasion ->
 * gift -> personalise -> pay). Single-select; "Just Because" is the
 * catch-all, so there's no separate skip path to design around.
 */
export function OccasionSelector({
  initialSelected,
  onContinue,
}: {
  initialSelected: OccasionId | null;
  onContinue: (occasion: OccasionId) => void;
}) {
  const [selected, setSelected] = useState<OccasionId | null>(initialSelected);
  const selectedLabel = OCCASIONS.find((o) => o.id === selected)?.label ?? null;

  return (
    <>
      <div className="flex flex-col gap-1.5 pb-8 text-center">
        <h1 className="font-display text-3xl font-normal" style={{ color: "var(--cream)" }}>
          What&rsquo;s the occasion?
        </h1>
        <p className="text-sm" style={{ color: "var(--cream-dim)" }}>
          Every gift starts with a reason.
        </p>
      </div>

      <div className={`grid grid-cols-2 gap-3 ${selected ? "pb-32" : "pb-10"}`}>
        {OCCASIONS.map((occasion, i) => {
          const active = occasion.id === selected;
          return (
            <button
              key={occasion.id}
              type="button"
              onClick={() => setSelected(occasion.id)}
              aria-pressed={active}
              className="flex min-h-26 flex-col justify-between border p-4 text-left"
              style={{
                borderColor: active ? "var(--gold)" : "var(--border)",
                background: active ? "var(--gold-glow)" : "transparent",
              }}
            >
              <span
                className="text-[10px] tracking-[0.2em]"
                style={{ color: active ? "var(--gold)" : "var(--gold-dim)" }}
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <span
                className="font-display text-xl leading-tight"
                style={{ color: active ? "var(--gold-light)" : "var(--cream)" }}
              >
                {occasion.label}
              </span>
            </button>
          );
        })}
      </div>

      {selected && selectedLabel && (
        <div
          className="fixed inset-x-0 bottom-0 border-t px-7 pt-4"
          style={{
            borderColor: "var(--border)",
            background: "rgba(14, 13, 11, 0.95)",
            paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1.25rem)",
          }}
        >
          <div className="mx-auto flex max-w-110 items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] tracking-wide" style={{ color: "var(--cream-dim)" }}>
                Occasion
              </p>
              <p className="font-display truncate text-lg" style={{ color: "var(--cream)" }}>
                {selectedLabel}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onContinue(selected)}
              className="shrink-0 px-6 py-3 text-sm font-medium tracking-wide"
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
