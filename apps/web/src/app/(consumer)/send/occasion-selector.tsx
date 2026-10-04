"use client";

import { useState } from "react";
import { OCCASIONS, type OccasionId } from "@/lib/occasions";

/**
 * First phase of the sender flow, per the Product Brief (occasion ->
 * gift -> personalise -> pay). Selection remains client-side only:
 * it shapes the message prompt and review summary without changing the
 * order request or any API contract.
 */
export function OccasionSelector({
  initialSelected,
  onContinue,
}: {
  initialSelected: OccasionId | null;
  onContinue: (occasion: OccasionId) => void;
}) {
  const [selected, setSelected] = useState<OccasionId | null>(initialSelected);
  const selectedLabel = OCCASIONS.find((occasion) => occasion.id === selected)?.label;

  return (
    <>
      <div className="pb-6">
        <h1 className="font-display text-3xl font-normal" style={{ color: "var(--cream)" }}>
          What&rsquo;s the occasion?
        </h1>
        <p className="mt-2 text-sm" style={{ color: "var(--cream-dim)" }}>
          Choose one to shape the message that follows.
        </p>
      </div>

      <div className={selected ? "grid grid-cols-2 gap-3 pb-32" : "grid grid-cols-2 gap-3 pb-10"}>
        {OCCASIONS.map((occasion, index) => {
          const active = occasion.id === selected;

          return (
            <button
              key={occasion.id}
              type="button"
              onClick={() => setSelected(occasion.id)}
              aria-pressed={active}
              className="flex min-h-28 flex-col justify-between border p-4 text-left transition-[border-color,background-color] duration-150"
              style={{
                borderColor: active ? "var(--gold)" : "var(--border)",
                background: active ? "var(--gold-glow)" : "transparent",
              }}
            >
              <span
                className="text-[10px] tracking-[0.18em]"
                style={{ color: active ? "var(--gold)" : "var(--gold-dim)" }}
              >
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="flex items-end justify-between gap-2">
                <span
                  className="font-display text-xl leading-tight"
                  style={{ color: active ? "var(--gold-light)" : "var(--cream)" }}
                >
                  {occasion.label}
                </span>
                {active && (
                  <span
                    aria-hidden="true"
                    className="mb-1 h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: "var(--gold)" }}
                  />
                )}
              </span>
            </button>
          );
        })}
      </div>

      {selected && selectedLabel && (
        <div
          className="fixed inset-x-0 bottom-0 z-10 border-t px-7 pt-4"
          style={{
            borderColor: "var(--border)",
            background: "rgba(14, 13, 11, 0.96)",
            backdropFilter: "blur(16px)",
            paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)",
          }}
        >
          <div className="mx-auto flex max-w-[440px] items-center justify-between gap-4">
            <p className="font-display min-w-0 truncate text-lg" style={{ color: "var(--cream)" }}>
              {selectedLabel}
            </p>
            <button
              type="button"
              onClick={() => onContinue(selected)}
              className="min-h-12 shrink-0 px-5 text-sm font-semibold transition-colors hover:bg-[color:var(--gold-light)]"
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
