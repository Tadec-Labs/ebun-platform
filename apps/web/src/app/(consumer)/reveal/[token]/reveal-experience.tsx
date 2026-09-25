"use client";

import { useState } from "react";
import { FulfillmentType } from "@ebun/types";
import type { RedemptionDetails, RevealPayload } from "@/lib/reveal/types";
import { DevScenarioSwitcher } from "./components/dev-scenario-switcher";
import { HoldToUnwrap } from "./components/hold-to-unwrap";
import { GiftMark, LockGlyph } from "@/components/icons";
import { MessagePlayer } from "./components/message-player";
import { ScratchPanel } from "./components/scratch-panel";
import { StatusLine } from "./components/status-line";

/**
 * Phase transitions below are local component state — nothing here
 * calls a real endpoint yet. When wiring the API:
 *  - reveal -> claimed:        POST /reveal/:token/accept (exists today)
 *  - reveal -> address:        no endpoint yet (physical fulfillment work, separate thread)
 *  - address -> transit:       no endpoint yet — needs somewhere to persist orders.delivery_address
 *  - arrival-message -> fulfilled: no endpoint yet — needs a way to record "recipient opened it"
 * transit/arrival-lock are reached directly on page load for a
 * returning visitor (see initialPhase), not via a button here.
 */
type Phase =
  | "entry"
  | "reveal"
  | "address"
  | "transit"
  | "arrival-lock"
  | "arrival-message"
  | "claimed"
  | "redeemed"
  | "fulfilled"
  | "not_ready"
  | "expired"
  | "unavailable";

function initialPhase(payload: RevealPayload): Phase {
  switch (payload.screenState) {
    case "not_ready":
      return "not_ready";
    case "expired":
      return "expired";
    case "unavailable":
      return "unavailable";
    case "claimed":
      return "claimed";
    case "redeemed":
      return "redeemed";
    case "awaiting_address":
      return "address"; // scratched on an earlier visit — no need to make them scratch again
    case "in_transit":
      return "transit";
    case "arrived":
      return "arrival-lock";
    case "fulfilled":
      return "fulfilled";
    case "ready":
    default:
      return "entry";
  }
}

/**
 * The real redemption record is created server-side by
 * POST /reveal/:token/accept (see RevealService.acceptGift), but that
 * endpoint doesn't return it in the response yet (see ./lib/reveal/types.ts).
 * This stands in for that response so the claimed screen has something
 * to render when reached via the on-page "Claim" action rather than a
 * pre-seeded mock scenario. Delete once the real endpoint returns it.
 */
function mockRedemption(): RedemptionDetails {
  return {
    fallbackCode: "EBN-4M8-2LP",
    qrPayload: "ebun:redeem:local-mock-token",
    vendorHint: "Any Ebun founding-partner spot — full list sent in your next message.",
    validUntil: undefined,
  };
}

export function RevealExperience({ token, initial }: { token: string; initial: RevealPayload }) {
  const [phase, setPhase] = useState<Phase>(() => initialPhase(initial));
  const [scratched, setScratched] = useState(
    !["ready", "not_ready", "expired", "unavailable"].includes(initial.screenState),
  );
  const [address, setAddress] = useState("");
  // mockRedemption() returns fixed literal values (no randomness), so
  // deriving it inline is safe and stable — no need to stash it in
  // state just to avoid recomputing.
  const redemption = initial.redemption ?? mockRedemption();
  const isPhysical = initial.fulfillmentType === FulfillmentType.Physical;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col px-7 pb-10">
      <div
        className="font-display pt-6 pb-2 text-center text-base tracking-[0.2em]"
        style={{ color: "var(--gold)" }}
      >
        EBUN
      </div>

      <div className="flex flex-1 flex-col">
        {phase === "not_ready" && <StatusScreen kind="not_ready" />}
        {phase === "expired" && <StatusScreen kind="expired" />}
        {phase === "unavailable" && <StatusScreen kind="unavailable" />}

        {phase === "entry" && (
          <EntryScreen
            recipientName={initial.recipientName}
            onBegin={() => setPhase("reveal")}
          />
        )}

        {phase === "reveal" && (
          <RevealScreen
            payload={initial}
            scratched={scratched}
            onScratched={() => setScratched(true)}
            onPrimaryAction={() => setPhase(isPhysical ? "address" : "claimed")}
          />
        )}

        {phase === "address" && (
          <AddressScreen
            giftName={initial.giftName}
            address={address}
            onChangeAddress={setAddress}
            onSubmit={() => setPhase("transit")}
          />
        )}

        {phase === "transit" && (
          <TransitScreen
            giftName={initial.giftName}
            senderName={initial.senderName}
            etaLabel={initial.deliveryEtaLabel}
          />
        )}

        {phase === "arrival-lock" && (
          <ArrivalLockScreen onUnwrapped={() => setPhase("arrival-message")} />
        )}

        {phase === "arrival-message" && initial.message && (
          <ArrivalMessageScreen
            payload={initial}
            onDone={() => setPhase("fulfilled")}
          />
        )}

        {phase === "claimed" && (
          <ClaimedScreen giftName={initial.giftName} redemption={redemption} />
        )}

        {phase === "redeemed" && (
          <TerminalScreen
            title="Already collected"
            body="This gift has already been redeemed at a vendor."
            giftName={initial.giftName}
          />
        )}

        {phase === "fulfilled" && (
          <TerminalScreen
            title="Delivered, and opened"
            body="You've already unwrapped this one."
            giftName={initial.giftName}
          />
        )}
      </div>

      <DevScenarioSwitcher current={token} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function EntryScreen({
  recipientName,
  onBegin,
}: {
  recipientName?: string;
  onBegin: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 text-center">
      <div
        className="flex h-20 w-20 items-center justify-center rounded-full border"
        style={{ borderColor: "var(--gold-dim)" }}
      >
        <svg
          viewBox="0 0 24 24"
          className="h-7 w-7"
          fill="none"
          stroke="var(--gold)"
          strokeWidth={1.3}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M4 6h16v12H4z" />
          <path d="M4 7l8 6 8-6" />
        </svg>
      </div>
      <div className="flex flex-col gap-3">
        <h1 className="font-display text-4xl font-normal leading-tight" style={{ color: "var(--cream)" }}>
          {recipientName ? `${recipientName}, someone's` : "Someone's"}
          <br />
          thinking of you.
        </h1>
        <p className="mx-auto max-w-[26ch] text-sm leading-relaxed" style={{ color: "var(--cream-dim)" }}>
          A gift is waiting, with a message attached.
        </p>
      </div>
      <button
        type="button"
        onClick={onBegin}
        className="px-10 py-3.5 text-sm font-medium tracking-wide"
        style={{ background: "var(--gold)", color: "var(--ink)" }}
      >
        Open it
      </button>
    </div>
  );
}

function GiftBlock({
  giftName,
  giftDescription,
  giftImageUrl,
}: {
  giftName?: string;
  giftDescription?: string | null;
  giftImageUrl?: string | null;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div
        className="flex h-44 w-full items-center justify-center border"
        style={{ borderColor: "var(--border)", background: "var(--panel-raised)" }}
      >
        {giftImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- mock data only; swap for next/image once real R2 URLs exist
          <img src={giftImageUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <GiftMark className="h-14 w-14 text-[color:var(--gold-dim)]" />
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <h2 className="font-display text-2xl font-normal" style={{ color: "var(--cream)" }}>
          {giftName ?? "A gift"}
        </h2>
        {giftDescription && (
          <p className="text-sm leading-relaxed" style={{ color: "var(--cream-dim)" }}>
            {giftDescription}
          </p>
        )}
      </div>
    </div>
  );
}

function RevealScreen({
  payload,
  scratched,
  onScratched,
  onPrimaryAction,
}: {
  payload: RevealPayload;
  scratched: boolean;
  onScratched: () => void;
  onPrimaryAction: () => void;
}) {
  const isPhysical = payload.fulfillmentType === FulfillmentType.Physical;

  const content = (
    <div className="flex h-full flex-col gap-6 py-2">
      {payload.senderName && (
        <p className="text-center text-xs" style={{ color: "var(--cream-dim)" }}>
          From <span style={{ color: "var(--gold-light)" }}>{payload.senderName}</span>
        </p>
      )}

      {!isPhysical && payload.message && (
        <MessagePlayer message={payload.message} />
      )}

      <GiftBlock
        giftName={payload.giftName}
        giftDescription={payload.giftDescription}
        giftImageUrl={payload.giftImageUrl}
      />

      {isPhysical && (
        <div
          className="flex items-center gap-3 border px-4 py-3"
          style={{ borderColor: "var(--border)" }}
        >
          <LockGlyph className="h-4 w-4 flex-shrink-0 text-[color:var(--gold-dim)]" />
          <p className="text-xs leading-snug" style={{ color: "var(--cream-dim)" }}>
            A message from {payload.senderName ?? "the sender"} unlocks the moment this arrives
            at your door.
          </p>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex flex-1 flex-col gap-6 pt-4">
      <ScratchPanel className="min-h-[360px] flex-1" onRevealed={onScratched}>
        {content}
      </ScratchPanel>

      {scratched && (
        <button
          type="button"
          onClick={onPrimaryAction}
          className="w-full py-3.5 text-sm font-medium tracking-wide"
          style={{ background: "var(--gold)", color: "var(--ink)" }}
        >
          {isPhysical ? "Continue" : "Claim your gift"}
        </button>
      )}
    </div>
  );
}

function AddressScreen({
  giftName,
  address,
  onChangeAddress,
  onSubmit,
}: {
  giftName?: string;
  address: string;
  onChangeAddress: (v: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-7">
      <div className="flex flex-col gap-2 text-center">
        <h2 className="font-display text-3xl font-normal" style={{ color: "var(--cream)" }}>
          Where should this go?
        </h2>
        <p className="text-sm" style={{ color: "var(--cream-dim)" }}>
          {giftName ? `${giftName} is ready to be sent your way.` : "Your gift is ready to send."}
        </p>
      </div>
      <textarea
        value={address}
        onChange={(e) => onChangeAddress(e.target.value)}
        placeholder="House number, street, area, city"
        rows={4}
        className="w-full resize-none border bg-transparent p-4 text-sm outline-none"
        style={{ borderColor: "var(--border-strong)", color: "var(--cream)" }}
      />
      <button
        type="button"
        onClick={onSubmit}
        disabled={address.trim().length < 6}
        className="w-full py-3.5 text-sm font-medium tracking-wide disabled:opacity-40"
        style={{ background: "var(--gold)", color: "var(--ink)" }}
      >
        Confirm delivery address
      </button>
    </div>
  );
}

function TransitScreen({
  giftName,
  senderName,
  etaLabel,
}: {
  giftName?: string;
  senderName?: string | null;
  etaLabel?: string;
}) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-10">
      <div className="flex flex-col gap-2 text-center">
        <h2 className="font-display text-3xl font-normal" style={{ color: "var(--cream)" }}>
          It&rsquo;s on its way.
        </h2>
        {etaLabel && (
          <p className="text-sm" style={{ color: "var(--gold-light)" }}>
            {etaLabel}
          </p>
        )}
        {giftName && (
          <p className="text-sm" style={{ color: "var(--cream-dim)" }}>
            {giftName}
          </p>
        )}
      </div>

      <StatusLine
        steps={[
          { label: "Confirmed", state: "done" },
          { label: "On its way", state: "current" },
          { label: "Arriving", state: "upcoming" },
        ]}
      />

      <div className="flex items-center gap-3 border px-4 py-3" style={{ borderColor: "var(--border)" }}>
        <LockGlyph className="h-4 w-4 flex-shrink-0 text-[color:var(--gold-dim)]" />
        <p className="text-xs leading-snug" style={{ color: "var(--cream-dim)" }}>
          {senderName ? `${senderName}'s` : "Their"} message opens with it, the moment it
          arrives.
        </p>
      </div>
    </div>
  );
}

function ArrivalLockScreen({ onUnwrapped }: { onUnwrapped: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 text-center">
      <div className="flex flex-col gap-2">
        <h2 className="font-display text-3xl font-normal" style={{ color: "var(--cream)" }}>
          It&rsquo;s here.
        </h2>
        <p className="mx-auto max-w-[28ch] text-sm" style={{ color: "var(--cream-dim)" }}>
          Your message has been waiting for this moment.
        </p>
      </div>
      <HoldToUnwrap onUnwrapped={onUnwrapped} />
    </div>
  );
}

function ArrivalMessageScreen({
  payload,
  onDone,
}: {
  payload: RevealPayload;
  onDone: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-8">
      <div className="flex flex-col gap-1 text-center">
        <h2 className="font-display text-3xl font-normal" style={{ color: "var(--cream)" }}>
          {payload.giftName ?? "For you"}
        </h2>
      </div>
      {payload.message && <MessagePlayer message={payload.message} senderName={payload.senderName} />}
      <button
        type="button"
        onClick={onDone}
        className="w-full py-3.5 text-sm font-medium tracking-wide"
        style={{ background: "var(--gold)", color: "var(--ink)" }}
      >
        That&rsquo;s everything
      </button>
    </div>
  );
}

function ClaimedScreen({
  giftName,
  redemption,
}: {
  giftName?: string;
  redemption: RedemptionDetails;
}) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-8">
      <div className="flex flex-col gap-2 text-center">
        <h2 className="font-display text-3xl font-normal" style={{ color: "var(--cream)" }}>
          It&rsquo;s yours.
        </h2>
        <p className="text-sm" style={{ color: "var(--cream-dim)" }}>
          Show this at the counter to collect {giftName ?? "it"}.
        </p>
      </div>

      <div
        className="flex flex-col items-center gap-4 border border-dashed px-6 py-8"
        style={{ borderColor: "var(--gold-dim)" }}
      >
        <div
          className="flex h-36 w-36 items-center justify-center text-[10px] tracking-wide"
          style={{ background: "var(--cream)", color: "var(--ink)" }}
        >
          QR CODE
        </div>
        <div className="text-center">
          <p className="font-display text-2xl tracking-[0.1em]" style={{ color: "var(--gold-light)" }}>
            {redemption.fallbackCode}
          </p>
          <p className="mt-1 text-[10px] tracking-wide" style={{ color: "var(--cream-dim)" }}>
            CODE, IF THE SCAN DOESN&rsquo;T WORK
          </p>
        </div>
      </div>

      {redemption.vendorHint && (
        <div className="border px-4 py-3.5" style={{ borderColor: "var(--border)", background: "var(--panel-raised)" }}>
          <p className="text-xs leading-relaxed" style={{ color: "var(--cream-dim)" }}>
            <span style={{ color: "var(--cream)" }}>Where to use it: </span>
            {redemption.vendorHint}
          </p>
        </div>
      )}
    </div>
  );
}

function TerminalScreen({
  title,
  body,
  giftName,
}: {
  title: string;
  body: string;
  giftName?: string;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <h2 className="font-display text-3xl font-normal" style={{ color: "var(--cream)" }}>
        {title}
      </h2>
      <p className="max-w-[28ch] text-sm" style={{ color: "var(--cream-dim)" }}>
        {body}
      </p>
      {giftName && (
        <p className="mt-2 text-xs tracking-wide" style={{ color: "var(--gold-dim)" }}>
          {giftName}
        </p>
      )}
    </div>
  );
}

function StatusScreen({ kind }: { kind: "not_ready" | "expired" | "unavailable" }) {
  const copy = {
    not_ready: {
      title: "Not quite ready",
      body: "This gift isn't ready to open just yet. Check back a little later.",
    },
    expired: {
      title: "This link has expired",
      body: "This gift is no longer available to open.",
    },
    unavailable: {
      title: "No longer available",
      body: "This gift can't be opened. If that seems wrong, ask the sender to check in.",
    },
  }[kind];

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <h2 className="font-display text-3xl font-normal" style={{ color: "var(--cream)" }}>
        {copy.title}
      </h2>
      <p className="max-w-[28ch] text-sm" style={{ color: "var(--cream-dim)" }}>
        {copy.body}
      </p>
    </div>
  );
}
