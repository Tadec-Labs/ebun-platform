"use client";

import { useState } from "react";
import type { GiftCatalogItem } from "@/lib/gifts/types";
import type { OccasionId } from "@/lib/occasions";
import { Compose, type MessageDraft } from "./compose";
import { GiftPicker } from "./gift-picker";
import { ReviewAndPay } from "./review-and-pay";

type Phase = "gift" | "compose" | "pay";

export interface SendDraft {
  occasion: OccasionId | null;
  gift: GiftCatalogItem | null;
  message: MessageDraft;
}

const EMPTY_MESSAGE: MessageDraft = {
  recipientName: "",
  recipientPhone: "",
  messageType: "text",
  text: "",
  recordedMedia: null,
  sendTiming: "now",
  scheduledFor: "",
};

const PHASES: { id: Phase; label: string }[] = [
  { id: "gift", label: "Gift" },
  { id: "compose", label: "Message" },
  { id: "pay", label: "Pay" },
];

/**
 * Three steps, down from four.
 *
 * The flow this replaces opened on an occasion picker, which was a full
 * gate that collected nothing — CreateOrderDto has no occasion field,
 * so its entire effect was choosing a message placeholder. For a
 * product whose competition is a bank transfer (a number, an amount, a
 * tap), a screen that costs the sender a decision and returns no value
 * is the most expensive thing in the app. The occasion now sits beside
 * the message box, doing its one real job.
 *
 * Recipient details moved in with the message because "who it's for and
 * what I want to say" is one thought, not two.
 *
 * Still one client component across phases, same reasoning as
 * reveal-experience.tsx: this is one form that submits as a single
 * POST /orders, not several independently-navigable pages.
 */
export function SendExperience({
  catalog,
  catalogReachable,
}: {
  catalog: GiftCatalogItem[];
  catalogReachable: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("gift");
  const [draft, setDraft] = useState<SendDraft>({
    occasion: null,
    gift: null,
    message: EMPTY_MESSAGE,
  });
  const currentPhaseIndex = PHASES.findIndex((item) => item.id === phase);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col px-7">
      <header className="pt-5 pb-7">
        <div className="flex items-center justify-between">
          <p className="font-display text-base tracking-[0.2em]" style={{ color: "var(--gold)" }}>
            EBUN
          </p>
          <p className="text-[11px] tracking-wide" style={{ color: "var(--cream-dim)" }}>
            Step {currentPhaseIndex + 1} of {PHASES.length}
          </p>
        </div>
        <ol className="mt-4 grid grid-cols-3 gap-1.5" aria-label="Send a gift progress">
          {PHASES.map((item, index) => {
            const isCurrent = index === currentPhaseIndex;
            const isComplete = index < currentPhaseIndex;
            return (
              <li key={item.id}>
                <span className="sr-only">
                  {item.label}: {isComplete ? "complete" : isCurrent ? "current step" : "upcoming"}
                </span>
                <span
                  aria-hidden="true"
                  className="block h-px"
                  style={{
                    background: isCurrent || isComplete ? "var(--gold)" : "var(--border-strong)",
                    opacity: isCurrent ? 1 : isComplete ? 0.65 : 0.5,
                  }}
                />
              </li>
            );
          })}
        </ol>
      </header>

      {phase === "gift" && (
        <GiftPicker
          catalog={catalog}
          catalogReachable={catalogReachable}
          onChoose={(gift) => {
            setDraft((prev) => ({ ...prev, gift }));
            setPhase("compose");
          }}
        />
      )}

      {phase === "compose" && draft.gift && (
        <Compose
          gift={draft.gift}
          draft={draft.message}
          occasion={draft.occasion}
          onChangeDraft={(message) => setDraft((prev) => ({ ...prev, message }))}
          onChangeOccasion={(occasion) => setDraft((prev) => ({ ...prev, occasion }))}
          onChangeGift={() => setPhase("gift")}
          onContinue={() => setPhase("pay")}
        />
      )}

      {phase === "pay" && draft.gift && (
        <ReviewAndPay
          gift={draft.gift}
          message={draft.message}
          onBack={() => setPhase("compose")}
        />
      )}
    </div>
  );
}
