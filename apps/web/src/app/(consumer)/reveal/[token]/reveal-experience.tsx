"use client";

import { useState, useTransition } from "react";
import { FulfillmentType } from "@ebun/types";
import type { RedemptionDetails, RevealPayload } from "@/lib/reveal/types";
import { claimGiftAction } from "./actions";
import { HoldToUnwrap } from "./components/hold-to-unwrap";
import { GiftMark, LockGlyph } from "@/components/icons";
import { MessagePlayer } from "./components/message-player";
import { ScratchPanel } from "./components/scratch-panel";
import { StatusLine } from "./components/status-line";

/**
 * Phase is local state; what it is allowed to start as comes from the
 * server (see initialPhase). Only one transition talks to the API:
 *  - reveal -> claimed:        POST /reveal/:token/accept, via claimGiftAction
 * The physical-journey phases below still have no endpoints behind
 * them — address capture and arrival-triggered reveal have no backend
 * contract — and no physical order can reach them today, because the
 * two delivered gift templates are withheld from the catalog until
 * that fulfillment path exists. The screens are kept rather than
 * deleted: they are the spec for that work, not dead code.
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

export function RevealExperience({ token, initial }: { token: string; initial: RevealPayload }) {
  const [phase, setPhase] = useState<Phase>(() => initialPhase(initial));
  const [scratched, setScratched] = useState(
    !["ready", "not_ready", "expired", "unavailable"].includes(initial.screenState),
  );
  const [address, setAddress] = useState("");
  // Starts as whatever the server already knew (a returning visitor who
  // claimed on an earlier visit), and is replaced by the real record
  // the claim call returns. Never invented locally: a code this screen
  // made up is a code no vendor can honour.
  const [claimed, setClaimed] = useState(() =>
    initial.redemption
      ? { redemption: initial.redemption, qrSvg: initial.qrSvg ?? null }
      : null,
  );
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claiming, startClaim] = useTransition();
  const isPhysical = initial.fulfillmentType === FulfillmentType.Physical;

  function claim() {
    setClaimError(null);
    startClaim(async () => {
      const result = await claimGiftAction(token);
      if (!result.ok) {
        setClaimError(result.message);
        return;
      }
      if (result.payload.redemption) {
        setClaimed({
          redemption: result.payload.redemption,
          qrSvg: result.payload.qrSvg ?? null,
        });
        setPhase("claimed");
        return;
      }
      // Accepted, but came back without a redemption — a VTU gift
      // (which auto-completes and has nothing to collect) or an order
      // that moved on. The server's own view is the authority on what
      // to show next, so follow it rather than guessing.
      setPhase(
        result.payload.screenState === "redeemed" ? "redeemed" : "not_ready",
      );
    });
  }

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
            onPrimaryAction={() => (isPhysical ? setPhase("address") : claim())}
            claiming={claiming}
            claimError={claimError}
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

        {phase === "claimed" && claimed && (
          <ClaimedScreen
            giftName={initial.giftName}
            redemption={claimed.redemption}
            qrSvg={claimed.qrSvg}
          />
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
  claiming,
  claimError,
}: {
  payload: RevealPayload;
  scratched: boolean;
  onScratched: () => void;
  onPrimaryAction: () => void;
  claiming: boolean;
  claimError: string | null;
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
        <div className="flex flex-col gap-3">
          {claimError && (
            <p
              role="alert"
              className="border px-4 py-3 text-xs leading-relaxed"
              style={{ borderColor: "var(--gold-dim)", color: "var(--cream-dim)" }}
            >
              {claimError}
            </p>
          )}
          <button
            type="button"
            onClick={onPrimaryAction}
            disabled={claiming}
            className="w-full py-3.5 text-sm font-medium tracking-wide disabled:opacity-60"
            style={{ background: "var(--gold)", color: "var(--ink)" }}
          >
            {claiming
              ? "Claiming\u2026"
              : isPhysical
                ? "Continue"
                : claimError
                  ? "Try again"
                  : "Claim your gift"}
          </button>
        </div>
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
  qrSvg,
}: {
  giftName?: string;
  redemption: RedemptionDetails;
  qrSvg: string | null;
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
        {qrSvg ? (
          <div
            className="h-40 w-40 [&>svg]:h-full [&>svg]:w-full"
            role="img"
            aria-label={`QR code for collection code ${redemption.fallbackCode}`}
            // The markup is produced by the QR encoder on our own
            // server from our own token — no recipient input reaches
            // it. Inlined rather than served as an <img> so it needs no
            // second request and no storage for a single-use picture.
            dangerouslySetInnerHTML={{ __html: qrSvg }}
          />
        ) : (
          <p
            className="flex h-40 w-40 items-center justify-center px-4 text-center text-[11px] leading-snug"
            style={{ background: "var(--cream)", color: "var(--ink)" }}
          >
            Read the code below out at the counter.
          </p>
        )}
        <div className="text-center">
          <p className="font-display text-2xl tracking-[0.1em]" style={{ color: "var(--gold-light)" }}>
            {redemption.fallbackCode}
          </p>
          <p className="mt-1 text-[10px] tracking-wide" style={{ color: "var(--cream-dim)" }}>
            CODE, IF THE SCAN DOESN&rsquo;T WORK
          </p>
        </div>
      </div>

      {redemption.validUntil && (
        <p className="text-center text-xs" style={{ color: "var(--cream-dim)" }}>
          Valid until{" "}
          {new Date(redemption.validUntil).toLocaleDateString("en-NG", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
        </p>
      )}

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
