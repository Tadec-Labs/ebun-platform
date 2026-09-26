"use client";

import { useState } from "react";
import type { GiftCatalogItem } from "@/lib/gifts/types";
import { GiftSelector } from "./gift-selector";
import { MessageComposer, type MessageDraft } from "./message-composer";

type Phase = "gift" | "message";

export interface SendDraft {
  gift: GiftCatalogItem | null;
  message: MessageDraft;
}

const EMPTY_MESSAGE: MessageDraft = {
  recipientName: "",
  recipientPhone: "",
  text: "",
  sendTiming: "now",
  scheduledFor: "",
};

/**
 * Owns the whole sender-flow wizard's state — one client component
 * across phases, same reasoning as reveal-experience.tsx: this is
 * fundamentally one form that submits together as a single
 * POST /orders call eventually, not several independently-navigable
 * pages, so there's no reason to fight Next.js routing to pass state
 * between separate route segments.
 */
export function SendExperience({ catalog }: { catalog: GiftCatalogItem[] }) {
  const [phase, setPhase] = useState<Phase>("gift");
  const [draft, setDraft] = useState<SendDraft>({
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

      {phase === "gift" && (
        <GiftSelector
          catalog={catalog}
          initialSelectedId={draft.gift?.id ?? null}
          onContinue={(gift) => {
            setDraft((prev) => ({ ...prev, gift }));
            setPhase("message");
          }}
        />
      )}

      {phase === "message" && draft.gift && (
        <MessageComposer
          gift={draft.gift}
          draft={draft.message}
          onChangeDraft={(message) => setDraft((prev) => ({ ...prev, message }))}
          onBack={() => setPhase("gift")}
        />
      )}
    </div>
  );
}
