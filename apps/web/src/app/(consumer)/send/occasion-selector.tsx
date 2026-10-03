"use client";

import { useState } from "react";
import { OCCASIONS, type OccasionId } from "@/lib/occasions";

const OCCASION_DETAILS: Record<OccasionId, string> = {
  birthday: "Make their day feel like theirs.",
  anniversary: "Mark the love worth celebrating.",
  new_baby: "A little joy for a new beginning.",
  promotion: "Celebrate the win they earned.",
  apology: "Show you mean more than the words.",
  just_because: "The best surprises need no reason.",
};

/**
 * First phase of the sender flow, per the Product Brief (occasion ->
 * gift -> personalise -> pay). The selected occasion still shapes only
 * the client-side message prompt and review summary; no order contract
 * or submission behaviour changes here.
 */
export function OccasionSelector({
  initialSelected,
  onContinue,
}: {
  initialSelected: OccasionId | null;
  onContinue: (occasion: OccasionId) => void;
}) {
  const [selected, setSelected] = useState<OccasionId | null>(initialSelected);
  const selectedOccasion = OCCASIONS.find((occasion) => occasion.id === selected);

  return (
    <>
      <div className="pb-7">
        <p className="text-[11px] font-medium tracking-[0.16em] uppercase" style={{ color: "var(--gold)" }}>
          Start with the feeling
        </p>
        <h1 className="font-display mt-3 text-4xl font-normal leading-[0.95]" style={{ color: "var(--cream)" }}>
          What&rsquo;s the occasion?
        </h1>
        <p className="mt-3 max-w-[31ch] text-sm leading-relaxed" style={{ color: "var(--cream-dim)" }}>
          Choose the reason behind the gift. We&rsquo;ll help make the rest feel personal.
        </p>
      </div>

      <div className={selected ? "grid grid-cols-2 gap-3 pb-36" : "grid grid-cols-2 gap-3 pb-10"}>
        {OCCASIONS.map((occasion, index) => {
          const active = occasion.id === selected;
          const detailId = "occasion-" + occasion.id + "-detail";

          return (
            <button
              key={occasion.id}
              type="button"
              onClick={() => setSelected(occasion.id)}
              aria-pressed={active}
              aria-describedby={detailId}
              className="group relative flex min-h-40 flex-col justify-between overflow-hidden border p-4 text-left transition-[border-color,background-color,transform] duration-200 hover:-translate-y-0.5"
              style={{
                borderColor: active ? "var(--gold)" : "var(--border)",
                background: active ? "rgba(201, 168, 76, 0.12)" : "var(--panel)",
              }}
            >
              <span className="flex items-center justify-between">
                <span
                  className="text-[10px] tracking-[0.2em]"
                  style={{ color: active ? "var(--gold-light)" : "var(--gold-dim)" }}
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span
                  aria-hidden="true"
                  className="flex h-5 w-5 items-center justify-center rounded-full border text-[11px]"
                  style={{
                    borderColor: active ? "var(--gold)" : "var(--border-strong)",
                    color: active ? "var(--ink)" : "transparent",
                    background: active ? "var(--gold)" : "transparent",
                  }}
                >
                  ✓
                </span>
              </span>

              <span>
                <span
                  className="font-display block text-[1.35rem] leading-tight"
                  style={{ color: active ? "var(--gold-light)" : "var(--cream)" }}
                >
                  {occasion.label}
                </span>
                <span
                  id={detailId}
                  className="mt-2 block text-[11px] leading-snug"
                  style={{ color: active ? "var(--cream-dim)" : "var(--cream-faint)" }}
                >
                  {OCCASION_DETAILS[occasion.id]}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {selected && selectedOccasion && (
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
              <p className="text-[10px] tracking-[0.14em] uppercase" style={{ color: "var(--gold-dim)" }}>
                Chosen occasion
              </p>
              <p className="font-display mt-0.5 truncate text-xl" style={{ color: "var(--cream)" }}>
                {selectedOccasion.label}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onContinue(selected)}
              className="inline-flex min-h-12 shrink-0 items-center gap-2 px-5 text-sm font-semibold transition-colors hover:bg-[color:var(--gold-light)]"
              style={{ background: "var(--gold)", color: "var(--ink)" }}
            >
              Choose gift <span aria-hidden="true">→</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
