"use client";

import { BrandLogo } from "@/components/brand-logo";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { FulfillmentType } from "@ebun/types";
import type { CollectionPoint, PickupBooking, RedemptionDetails, RevealPayload } from "@/lib/reveal/types";
import { claimGiftAction, refreshRevealAction } from "./actions";
import { AddressScreen, TransitScreen } from "./components/delivery-screens";
import { HoldToUnwrap } from "./components/hold-to-unwrap";
import { GiftMark, LockGlyph } from "@/components/icons";
import { MessagePlayer } from "./components/message-player";
import { PickupBookingPanel } from "./components/pickup-booking";
import { ScratchPanel } from "./components/scratch-panel";

/**
 * Phase is local state; what it is allowed to start as comes from the
 * server (see initialPhase). Transitions that talk to the API:
 *  - reveal -> claimed:          POST /reveal/:token/accept (vouchers)
 *  - address -> transit:         POST /reveal/:token/delivery (doorstep gifts)
 *  - arrival-message -> fulfilled: POST /reveal/:token/accept (marks it opened)
 * While a doorstep gift is on its way the page re-reads itself every
 * minute, so "It's here" appears on a phone left open on this screen.
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
  // The doorstep-delivery half of the payload, replaced as the page
  // re-reads itself — the sender's message only arrives with delivery.
  const [live, setLive] = useState(initial);
  // Starts as whatever the server already knew (a returning visitor who
  // claimed on an earlier visit), and is replaced by the real record
  // the claim call returns. Never invented locally: a code this screen
  // made up is a code no vendor can honour.
  const [claimed, setClaimed] = useState(() =>
    initial.redemption
      ? { redemption: initial.redemption, qrSvg: initial.qrSvg ?? null }
      : null,
  );
  const [pickup, setPickup] = useState<PickupBooking | null>(initial.pickup ?? null);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claiming, startClaim] = useTransition();
  const isPhysical = initial.fulfillmentType === FulfillmentType.Physical;

  // Follow a delivery while it's on its way. Once a minute, only while
  // the tab is visible (a pocketed phone shouldn't burn data), and it
  // stops itself at "arrived".
  useEffect(() => {
    if (!isPhysical || phase !== "transit") return;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      const next = await refreshRevealAction(token);
      if (!next) return;
      setLive(next);
      if (next.screenState === "arrived") setPhase("arrival-lock");
      else if (next.screenState === "fulfilled") setPhase("fulfilled");
    };
    const timer = setInterval(() => void tick(), 60_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [isPhysical, phase, token]);

  /** Unwrapped after delivery: tell the server (best effort — the moment already happened). */
  function finishDelivered() {
    setPhase("fulfilled");
    void claimGiftAction(token);
  }

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
      {/* Not a link: tapping the logo mid-gift shouldn't take the
          recipient away from what they were sent. */}
      <div className="flex justify-center pt-6 pb-2">
        <BrandLogo size="sm" href={null} />
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
            token={token}
            giftName={initial.giftName}
            current={live.delivery?.address ? live.delivery : null}
            onSaved={(payload) => {
              setLive(payload);
              setPhase("transit");
            }}
            onCancel={live.delivery?.address ? () => setPhase("transit") : undefined}
          />
        )}

        {phase === "transit" && (
          <TransitScreen
            giftName={initial.giftName}
            senderName={initial.senderName}
            delivery={live.delivery ?? null}
            messageLocked={Boolean(live.messageLocked)}
            onChangeAddress={() => setPhase("address")}
          />
        )}

        {phase === "arrival-lock" && (
          <ArrivalLockScreen
            hasMessage={Boolean(live.message)}
            onUnwrapped={() => (live.message ? setPhase("arrival-message") : finishDelivered())}
          />
        )}

        {phase === "arrival-message" && live.message && (
          <ArrivalMessageScreen payload={live} onDone={finishDelivered} />
        )}

        {phase === "claimed" && claimed && (
          <ClaimedScreen
            giftName={initial.giftName}
            redemption={claimed.redemption}
            qrSvg={claimed.qrSvg}
            pickupPanel={
              <PickupBookingPanel
                token={token}
                places={claimed.redemption.collectAt}
                giftName={initial.giftName}
                recipientName={initial.recipientName}
                appointment={initial.bookingStyle === "appointment"}
                booking={pickup}
                onBooked={setPickup}
              />
            }
          />
        )}

        {phase === "redeemed" && (
          <CollectedScreen giftName={initial.giftName} collected={initial.collected} />
        )}

        {phase === "fulfilled" && (
          <CollectedScreen
            giftName={initial.giftName}
            delivered
            collected={{
              at: live.delivery?.deliveredAt ?? null,
              placeName: live.delivery?.placeName ?? null,
            }}
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
        style={{ background: "var(--action)", color: "var(--ink)" }}
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

      {isPhysical && payload.messageLocked && (
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
            style={{ background: "var(--action)", color: "var(--ink)" }}
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

function ArrivalLockScreen({
  hasMessage,
  onUnwrapped,
}: {
  hasMessage: boolean;
  onUnwrapped: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 text-center">
      <div className="flex flex-col gap-2">
        <h2 className="font-display text-3xl font-normal" style={{ color: "var(--cream)" }}>
          It&rsquo;s here.
        </h2>
        <p className="mx-auto max-w-[28ch] text-sm" style={{ color: "var(--cream-dim)" }}>
          {hasMessage ? "Your message has been waiting for this moment." : "Hold to open it properly."}
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
        style={{ background: "var(--action)", color: "var(--ink)" }}
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
  pickupPanel,
}: {
  giftName?: string;
  redemption: RedemptionDetails;
  qrSvg: string | null;
  /** "When are you collecting?" — sits right under the headline: it's the next thing to do. */
  pickupPanel: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-8">
      <div className="flex flex-col gap-2 text-center">
        <h2 className="font-display text-3xl font-normal" style={{ color: "var(--cream)" }}>
          It&rsquo;s yours.
        </h2>
        <p className="text-sm" style={{ color: "var(--cream-dim)" }}>
          {collectInstruction(giftName, redemption.collectAt)}
        </p>
      </div>

      {pickupPanel}

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

      <CollectAt places={redemption.collectAt} />

      {/*
        The end of the recipient's journey, and the single highest-value
        moment in the product — which until now did nothing at all.
        The Brief calls the diaspora sender "Ebun's viral engine", on the
        reasoning that "every gift introduces a new recipient who then
        becomes a sender". There was no path from receiving to sending:
        the screen simply stopped, and the most likely sender Ebun will
        ever have closed the tab.
      */}
      <div className="flex flex-col gap-3">
        <p className="text-center text-xs leading-relaxed" style={{ color: "var(--cream-faint)" }}>
          Screenshot this — you&rsquo;ll need the code at the counter.
        </p>
        <Link
          href="/send"
          className="w-full py-3.5 text-center text-sm font-medium tracking-wide"
          style={{ background: "var(--action)", color: "var(--ink)" }}
        >
          Send one back
        </Link>
      </div>

    </div>
  );
}

/**
 * The line under "It's yours." Names the place when there is exactly
 * one, because "show this at Burger Hub" is an instruction and "show
 * this at the counter" is a riddle.
 */
function collectInstruction(giftName: string | undefined, places: CollectionPoint[]): string {
  const gift = giftName ?? "your gift";
  if (places.length === 1) return `Show this at ${places[0].name} to collect ${gift}.`;
  if (places.length > 1) return `Show this at any of the places below to collect ${gift}.`;
  return `Show this code when you collect ${gift}.`;
}

/**
 * Where to go. Each place gets its address as written by ops (Lagos
 * addresses lean on landmarks, so it is shown verbatim, not
 * reformatted), its hours, and a directions link.
 *
 * Directions open Google Maps searching for "name, address" — no
 * coordinates stored, no maps SDK loaded. On a phone that hands off to
 * the Maps app, which is where someone heading out the door wants to be.
 *
 * With no places, it says so plainly rather than hiding the section:
 * an absent "where" reads as an oversight, a stated one reads as a
 * temporary state with the code still safe.
 */
function CollectAt({ places }: { places: CollectionPoint[] }) {
  if (places.length === 0) {
    return (
      <div className="border px-4 py-3.5" style={{ borderColor: "var(--border)", background: "var(--panel-raised)" }}>
        <p className="text-xs leading-relaxed" style={{ color: "var(--cream-dim)" }}>
          <span style={{ color: "var(--cream)" }}>Where to collect: </span>
          we&rsquo;re confirming the location. Keep this code &mdash; it stays valid until the date above.
        </p>
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-3" aria-label="Where to collect">
      <h3 className="text-[10px] tracking-[0.16em] uppercase" style={{ color: "var(--gold-dim)" }}>
        {places.length === 1 ? "Where to collect" : "Where you can collect"}
      </h3>
      <ul className="flex flex-col gap-2.5">
        {places.map((place) => (
          <li
            key={`${place.name}|${place.address}`}
            className="flex flex-col gap-1.5 border px-4 py-3.5"
            style={{ borderColor: "var(--border)", background: "var(--panel-raised)" }}
          >
            <p className="font-display text-lg leading-tight" style={{ color: "var(--cream)" }}>
              {place.name}
            </p>
            <p className="text-xs leading-relaxed" style={{ color: "var(--cream-dim)" }}>
              {place.address}
            </p>
            {place.hours && (
              <p className="text-[11px]" style={{ color: "var(--cream-faint)" }}>
                {place.hours}
              </p>
            )}
            <a
              href={directionsUrl(place)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 self-start border-b pb-0.5 text-xs tracking-wide"
              style={{ borderColor: "var(--gold-dim)", color: "var(--gold-light)" }}
            >
              Get directions &rarr;
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function directionsUrl(place: CollectionPoint): string {
  const query = encodeURIComponent(`${place.name}, ${place.address}`);
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

/**
 * After the handover. It used to read "already been redeemed at a
 * vendor" — accurate, and a dead end at the one moment the recipient
 * is most likely to want to send something back: they have just been
 * handed a gift. Says where and when (useful if anything is disputed,
 * and simply nicer), then offers the way to return the favour.
 */
function CollectedScreen({
  giftName,
  collected,
  delivered = false,
}: {
  giftName?: string;
  collected?: { at: string | null; placeName: string | null };
  /** A doorstep gift: "Delivered by X", not "Collected at X". */
  delivered?: boolean;
}) {
  const when = collected?.at
    ? new Date(collected.at).toLocaleDateString("en-NG", { day: "numeric", month: "long" })
    : null;
  const where = collected?.placeName ?? null;
  const verb = delivered ? "Delivered" : "Collected";
  const prep = delivered ? "by" : "at";
  const detail =
    where && when
      ? `${verb} ${prep} ${where} on ${when}.`
      : where
        ? `${verb} ${prep} ${where}.`
        : when
          ? `${verb} on ${when}.`
          : delivered
            ? "Your gift has been delivered."
            : "This gift has been collected.";

  return (
    <div className="flex flex-1 flex-col justify-center gap-10 text-center">
      <div className="flex flex-col items-center gap-4">
        <GiftMark className="h-12 w-12 text-[color:var(--gold)]" />
        <h2 className="font-display text-4xl font-normal" style={{ color: "var(--cream)" }}>
          Enjoy it.
        </h2>
        <p className="max-w-[30ch] text-sm leading-relaxed" style={{ color: "var(--cream-dim)" }}>
          {detail}
        </p>
        {giftName && (
          <p className="text-xs tracking-wide" style={{ color: "var(--gold-dim)" }}>
            {giftName}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-3">
        <p className="text-xs" style={{ color: "var(--cream-faint)" }}>
          Someone made your day. Make someone else&rsquo;s.
        </p>
        <Link
          href="/send"
          className="w-full py-3.5 text-center text-sm font-medium tracking-wide"
          style={{ background: "var(--action)", color: "var(--ink)" }}
        >
          Send one back
        </Link>
      </div>
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
