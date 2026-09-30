"use client";

import { useState } from "react";
import type { GiftCatalogItem } from "@/lib/gifts/types";
import type { OccasionId } from "@/lib/occasions";
import { GiftSelector } from "./gift-selector";
import { MessageComposer, type MessageDraft } from "./message-composer";
import { OccasionSelector } from "./occasion-selector";
import { ReviewAndPay } from "./review-and-pay";

type Phase = "occasion" | "gift" | "message" | "review";

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

/**
 * Owns the whole sender-flow wizard's state — one client component
 * across phases, same reasoning as reveal-experience.tsx: this is
 * fundamentally one form that submits together as a single
 * POST /orders call, not several independently-navigable pages, so
 * there's no reason to fight Next.js routing to pass state between
 * separate route segments.
 */
export function SendExperience({ catalog }: { catalog: GiftCatalogItem[] }) {
  const [phase, setPhase] = useState<Phase>("occasion");
  const [draft, setDraft] = useState<SendDraft>({
    occasion: null,
    gift: null,
    message: EMPTY_MESSAGE,
  });

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col px-7">
      <div
        className="font-display pt-6 pb-8 text-center text-base tracking-[0.2em]"
        style={{ color: "var(--gold)" }}
      >
        EBUN
      </div>

      {phase === "occasion" && (
        <OccasionSelector
          initialSelected={draft.occasion}
          onContinue={(occasion) => {
            setDraft((prev) => ({ ...prev, occasion }));
            setPhase("gift");
          }}
        />
      )}

      {phase === "gift" && (
        <GiftSelector
          catalog={catalog}
          initialSelectedId={draft.gift?.id ?? null}
          onBack={() => setPhase("occasion")}
          onContinue={(gift) => {
            setDraft((prev) => ({ ...prev, gift }));
            setPhase("message");
          }}
        />
      )}

      {phase === "message" && draft.gift && (
        <MessageComposer
          gift={draft.gift}
          occasion={draft.occasion}
          draft={draft.message}
          onChangeDraft={(message) => setDraft((prev) => ({ ...prev, message }))}
          onBack={() => setPhase("gift")}
          onContinue={() => setPhase("review")}
        />
      )}

      {phase === "review" && draft.gift && (
        <ReviewAndPay
          gift={draft.gift}
          occasion={draft.occasion}
          message={draft.message}
          onBack={() => setPhase("message")}
        />
      )}
    </div>
  );
}
