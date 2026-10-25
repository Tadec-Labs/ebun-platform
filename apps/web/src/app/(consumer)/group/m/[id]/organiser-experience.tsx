"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { BrandLogo } from "@/components/brand-logo";
import { CheckGlyph } from "@/components/icons";
import { formatNaira } from "@/lib/format-money";
import type { GroupGiftOrganiserView } from "@/lib/group/types";
import { whatsappChatUrl } from "@/lib/whatsapp-share";
import { GiftCard, PotProgress, deadlineLabel } from "../../pot-parts";
import { cancelAction, extendAction, switchAction } from "./actions";

const DAY = 86_400_000;

interface AffordableGift {
  id: string;
  name: string;
  imageUrl: string | null;
  price: number;
}

/**
 * The organiser's page. Three jobs, in the order they come up:
 *   1. get the link into the group (share);
 *   2. if the deadline passes short, decide — extend, switch, or cancel —
 *      never left to discover a "failed" gift;
 *   3. once it's paid for, send it to the recipient.
 *
 * The organiser never touches the money: there is no "withdraw", only
 * the gift or a refund to each person.
 */
export function OrganiserExperience({
  shortId,
  view,
  affordable,
  organiserLinkPath,
}: {
  shortId: string;
  view: GroupGiftOrganiserView;
  affordable: AffordableGift[];
  organiserLinkPath: string | null;
}) {
  const recipient = view.recipientName.trim().split(/\s+/)[0] || view.recipientName;
  const open = view.status === "open";
  const paidFor = view.status === "triggered" || view.status === "funded";
  const closed = view.status === "cancelled" || view.status === "expired";
  const paying = view.contributors.filter((c) => c.status === "confirmed");

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col px-7">
      <header className="flex items-center justify-between pt-5 pb-7">
        <BrandLogo size="sm" />
        {open && !view.awaitingDecision && (
          <p className="text-[11px] tracking-wide" style={{ color: "var(--cream-dim)" }}>
            {deadlineLabel(view.deadline)}
          </p>
        )}
      </header>

      <div className="pb-6">
        <p className="text-[11px] uppercase tracking-[0.2em]" style={{ color: "var(--gold-dim)" }}>
          Your group gift
        </p>
        <h1 className="mt-2 font-display text-3xl leading-tight font-normal" style={{ color: "var(--cream)" }}>
          {paidFor ? (
            <>
              It&rsquo;s paid for. Time to send it to <span style={{ color: "var(--gold-light)" }}>{recipient}</span>.
            </>
          ) : closed ? (
            <>This group gift has closed.</>
          ) : view.awaitingDecision ? (
            <>The deadline&rsquo;s passed. What next?</>
          ) : (
            <>
              For <span style={{ color: "var(--gold-light)" }}>{recipient}</span>, from all of you.
            </>
          )}
        </h1>
      </div>

      <div className="flex flex-col gap-6 pb-8">
        <GiftCard gift={view.gift} caption={formatNaira(view.targetAmount)} />
        <PotProgress
          raised={view.amountRaised}
          target={view.targetAmount}
          contributorCount={paying.length}
          funded={paidFor}
        />

        {paidFor && view.revealPath && (
          <SendToRecipient
            recipient={recipient}
            revealPath={view.revealPath}
            doorstep={view.gift.deliveryType === "physical"}
          />
        )}

        {open && view.awaitingDecision && (
          <Decision shortId={shortId} view={view} affordable={affordable} recipient={recipient} />
        )}

        {open && !view.awaitingDecision && (
          <ShareWithGroup recipient={recipient} giftName={view.gift.name} sharePath={view.sharePath} />
        )}

        {closed && (
          <p className="text-sm leading-relaxed" style={{ color: "var(--cream-dim)" }}>
            {view.closeReason ?? "It was closed."} Everyone who paid is refunded in full, automatically — you
            don&rsquo;t need to do anything. Their status is below.
          </p>
        )}

        <Contributors view={view} />

        {open && !view.awaitingDecision && (view.canExtend || view.canCancel) && (
          <MoreOptions shortId={shortId} view={view} />
        )}

        {organiserLinkPath && <KeepThisLink organiserLinkPath={organiserLinkPath} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ShareWithGroup({ recipient, giftName, sharePath }: { recipient: string; giftName: string; sharePath: string }) {
  const [copied, setCopied] = useState(false);
  const url = () => `${window.location.origin}${sharePath}`;
  const text = () => `Let's get ${recipient} something special 🎁 (${giftName}). Chip in any amount and add a message here:\n${url()}`;

  return (
    <section className="flex flex-col gap-3 border p-4" style={{ borderColor: "var(--border-strong)", background: "var(--panel)" }}>
      <p className="text-sm" style={{ color: "var(--cream)" }}>
        Share this link in your group
      </p>
      <p className="text-xs leading-relaxed" style={{ color: "var(--cream-dim)" }}>
        Everyone pays their own share on one page — no account numbers, no screenshots, no chasing. You never hold
        anyone&rsquo;s money.
      </p>
      <a
        href="#"
        onClick={(e) => {
          e.preventDefault();
          window.location.href = whatsappChatUrl(null, text());
        }}
        className="w-full py-3.5 text-center text-sm font-medium tracking-wide"
        style={{ background: "var(--action)", color: "var(--ink)" }}
      >
        Share on WhatsApp
      </a>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(url()).catch(() => undefined);
            setCopied(true);
            setTimeout(() => setCopied(false), 2_000);
          }}
          className="flex-1 border py-2.5 text-xs"
          style={{ borderColor: "var(--border)", color: "var(--cream-dim)" }}
        >
          {copied ? "Link copied" : "Copy link"}
        </button>
        <Link
          href={sharePath}
          className="flex-1 border py-2.5 text-center text-xs"
          style={{ borderColor: "var(--border)", color: "var(--gold-light)" }}
        >
          Add your own share
        </Link>
      </div>
    </section>
  );
}

function SendToRecipient({
  recipient,
  revealPath,
  doorstep,
}: {
  recipient: string;
  revealPath: string;
  doorstep: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const url = () => `${window.location.origin}${revealPath}`;
  return (
    <section className="flex flex-col gap-3 border p-4" style={{ borderColor: "var(--success)", background: "var(--panel)" }}>
      <p className="text-xs leading-relaxed" style={{ color: "var(--cream-dim)" }}>
        Send {recipient} their link. They&rsquo;ll scratch to reveal the gift, then see everyone&rsquo;s names and
        messages.
        {doorstep && " It asks them where to deliver it — the surprise stays intact."}
      </p>
      <a
        href="#"
        onClick={(e) => {
          e.preventDefault();
          window.location.href = whatsappChatUrl(null, `${recipient}, we got you something 🎁\n\nOpen it here:\n${url()}`);
        }}
        className="w-full py-3.5 text-center text-sm font-medium tracking-wide"
        style={{ background: "var(--action)", color: "var(--ink)" }}
      >
        Send it to {recipient} on WhatsApp
      </a>
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(url()).catch(() => undefined);
          setCopied(true);
          setTimeout(() => setCopied(false), 2_000);
        }}
        className="border py-2.5 text-xs"
        style={{ borderColor: "var(--border)", color: "var(--cream-dim)" }}
      >
        {copied ? "Link copied" : `Copy ${recipient}'s link`}
      </button>
      <p className="text-[11px] leading-relaxed" style={{ color: "var(--cream-faint)" }}>
        Don&rsquo;t post this one in the group — it&rsquo;s {recipient}&rsquo;s gift.
      </p>
    </section>
  );
}

function Decision({
  shortId,
  view,
  affordable,
  recipient,
}: {
  shortId: string;
  view: GroupGiftOrganiserView;
  affordable: AffordableGift[];
  recipient: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const short = view.targetAmount - view.amountRaised;
  const choice = affordable.find((g) => g.id === picked) ?? null;

  const extendBy = (days: number) =>
    start(async () => {
      setError(null);
      const result = await extendAction(shortId, extendedDeadline(view.deadline, days));
      if (!result.ok) setError(result.error);
    });

  return (
    <section className="flex flex-col gap-5">
      <p className="text-sm leading-relaxed" style={{ color: "var(--cream-dim)" }}>
        You&rsquo;re {formatNaira(short)} short. Pick one before{" "}
        {view.decisionDeadline
          ? new Date(view.decisionDeadline).toLocaleString("en-NG", { weekday: "short", hour: "numeric", minute: "2-digit" })
          : "the window closes"}
        , or everyone is refunded in full automatically.
      </p>

      <Option title="Top it up yourself" body={`Add the last ${formatNaira(short)} as your own share, and it goes to ${recipient} straight away.`}>
        <Link
          href={view.sharePath}
          className="block w-full py-3 text-center text-sm font-medium"
          style={{ background: "var(--action)", color: "var(--ink)" }}
        >
          Add {formatNaira(short)}
        </Link>
      </Option>

      {view.canExtend && (
        <Option title="Give people more time" body="Once, by up to a week. Everyone's share stays where it is.">
          <div className="flex gap-2">
            {[1, 3, 7].map((d) => (
              <button
                key={d}
                type="button"
                disabled={pending}
                onClick={() => extendBy(d)}
                className="flex-1 border py-2.5 text-xs disabled:opacity-50"
                style={{ borderColor: "var(--border-strong)", color: "var(--gold-light)" }}
              >
                +{d} {d === 1 ? "day" : "days"}
              </button>
            ))}
          </div>
        </Option>
      )}

      {view.canSwitch && (
        <Option
          title="Switch to a gift the pot covers"
          body={
            affordable.length
              ? "It goes ahead today. Anything left over goes back to everyone, split by what each gave."
              : `Nothing on sale is ${formatNaira(view.amountRaised)} or less right now.`
          }
        >
          {affordable.length > 0 && (
            <div className="flex flex-col gap-2">
              {affordable.slice(0, 6).map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setPicked(g.id)}
                  aria-pressed={picked === g.id}
                  className="flex items-center justify-between border px-3 py-2.5 text-left text-xs"
                  style={{
                    borderColor: picked === g.id ? "var(--gold)" : "var(--border)",
                    background: picked === g.id ? "var(--gold-glow)" : "transparent",
                    color: "var(--cream)",
                  }}
                >
                  <span className="truncate pr-3">{g.name}</span>
                  <span style={{ color: "var(--gold-light)" }}>{formatNaira(g.price)}</span>
                </button>
              ))}
              {choice && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      setError(null);
                      const result = await switchAction(shortId, choice.id);
                      if (!result.ok) setError(result.error);
                    })
                  }
                  className="mt-1 w-full py-3 text-sm font-medium disabled:opacity-50"
                  style={{ background: "var(--action)", color: "var(--ink)" }}
                >
                  {pending
                    ? "Switching…"
                    : view.amountRaised > choice.price
                      ? `Send ${choice.name} · ${formatNaira(view.amountRaised - choice.price)} back to everyone`
                      : `Send ${choice.name}`}
                </button>
              )}
            </div>
          )}
        </Option>
      )}

      {view.canCancel && (
        <Option title="Call it off" body="Everyone gets back exactly what they paid, fee included.">
          {confirmCancel ? (
            <div className="flex gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    setError(null);
                    const result = await cancelAction(shortId);
                    if (!result.ok) setError(result.error);
                  })
                }
                className="flex-1 border py-2.5 text-xs disabled:opacity-50"
                style={{ borderColor: "var(--error)", color: "var(--error)" }}
              >
                {pending ? "Refunding…" : "Yes, refund everyone"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmCancel(false)}
                className="flex-1 border py-2.5 text-xs"
                style={{ borderColor: "var(--border)", color: "var(--cream-dim)" }}
              >
                Keep it open
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmCancel(true)}
              className="w-full border py-2.5 text-xs"
              style={{ borderColor: "var(--border)", color: "var(--cream-dim)" }}
            >
              Cancel and refund everyone
            </button>
          )}
        </Option>
      )}

      {error && (
        <p role="alert" className="text-xs" style={{ color: "var(--error)" }}>
          {error}
        </p>
      )}
    </section>
  );
}

/** Before the deadline: extend or cancel, tucked away — sharing is the job then. */
function MoreOptions({ shortId, view }: { shortId: string; view: GroupGiftOrganiserView }) {
  const [openPanel, setOpenPanel] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  if (!openPanel) {
    return (
      <button
        type="button"
        onClick={() => setOpenPanel(true)}
        className="self-start text-xs underline underline-offset-2"
        style={{ color: "var(--cream-dim)" }}
      >
        More time, or call it off
      </button>
    );
  }
  return (
    <section className="flex flex-col gap-3 border p-4" style={{ borderColor: "var(--border)" }}>
      {view.canExtend && (
        <div className="flex gap-2">
          {[1, 3, 7].map((d) => (
            <button
              key={d}
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setError(null);
                  const result = await extendAction(shortId, extendedDeadline(view.deadline, d));
                  if (!result.ok) setError(result.error);
                })
              }
              className="flex-1 border py-2.5 text-xs disabled:opacity-50"
              style={{ borderColor: "var(--border-strong)", color: "var(--gold-light)" }}
            >
              +{d} {d === 1 ? "day" : "days"}
            </button>
          ))}
        </div>
      )}
      {view.canCancel &&
        (confirmCancel ? (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const result = await cancelAction(shortId);
                if (!result.ok) setError(result.error);
              })
            }
            className="border py-2.5 text-xs disabled:opacity-50"
            style={{ borderColor: "var(--error)", color: "var(--error)" }}
          >
            {pending ? "Refunding…" : "Yes, cancel and refund everyone in full"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmCancel(true)}
            className="border py-2.5 text-xs"
            style={{ borderColor: "var(--border)", color: "var(--cream-dim)" }}
          >
            Cancel and refund everyone
          </button>
        ))}
      {view.canExtend && (
        <p className="text-[11px]" style={{ color: "var(--cream-faint)" }}>
          You can extend once, by up to a week.
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs" style={{ color: "var(--error)" }}>
          {error}
        </p>
      )}
    </section>
  );
}

function Contributors({ view }: { view: GroupGiftOrganiserView }) {
  if (view.contributors.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <p className="text-xs" style={{ color: "var(--cream-dim)" }}>
        Who&rsquo;s in {view.showAmounts ? "" : "· only you see the amounts"}
      </p>
      <ul className="flex flex-col divide-y border" style={{ borderColor: "var(--border)" }}>
        {view.contributors.map((c, i) => (
          <li key={`${c.name}-${i}`} className="flex flex-col gap-1 px-3 py-2.5" style={{ borderColor: "var(--border)" }}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate" style={{ color: "var(--cream)" }}>
                {c.name}
              </span>
              <span style={{ color: "var(--gold-light)" }}>{formatNaira(c.amount)}</span>
            </div>
            {c.message && (
              <p className="text-xs italic leading-snug" style={{ color: "var(--cream-dim)" }}>
                &ldquo;{c.message}&rdquo;
              </p>
            )}
            {refundLine(c) && (
              <p className="text-[11px]" style={{ color: c.refundStatus === "failed" ? "var(--error)" : "var(--cream-faint)" }}>
                {refundLine(c)}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function refundLine(c: GroupGiftOrganiserView["contributors"][number]): string | null {
  if (!c.refundStatus || !c.refundAmount) return c.status === "late" ? "Paid after it closed — being refunded" : null;
  const amount = formatNaira(c.refundAmount);
  switch (c.refundStatus) {
    case "completed":
      return `${amount} refunded`;
    case "failed":
      return `${amount} refund needs SendEbun's help — we'll sort it with them`;
    default:
      return `${amount} on its way back`;
  }
}

function Option({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border p-4" style={{ borderColor: "var(--border)", background: "var(--panel)" }}>
      <div>
        <p className="text-sm" style={{ color: "var(--cream)" }}>
          {title}
        </p>
        <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--cream-dim)" }}>
          {body}
        </p>
      </div>
      {children}
    </div>
  );
}

/**
 * The organiser page lives in a cookie on this device. If they open the
 * gift on another phone, or clear their browser, this link is the only
 * way back — there's no account to sign in to.
 */
function KeepThisLink({ organiserLinkPath }: { organiserLinkPath: string }) {
  const [copied, setCopied] = useState(false);
  const url = () => `${window.location.origin}${organiserLinkPath}`;
  return (
    <section className="flex items-start gap-3 border-t pt-5" style={{ borderColor: "var(--border)" }}>
      <CheckGlyph className="mt-0.5 h-4 w-4 flex-shrink-0 text-[color:var(--gold-dim)]" />
      <div className="flex flex-col gap-2">
        <p className="text-xs leading-relaxed" style={{ color: "var(--cream-dim)" }}>
          Keep your organiser link — it&rsquo;s how you get back here from another phone. Don&rsquo;t share it: it
          lets whoever has it manage the gift.
        </p>
        <div className="flex gap-4">
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(url()).catch(() => undefined);
              setCopied(true);
              setTimeout(() => setCopied(false), 2_000);
            }}
            className="text-xs underline underline-offset-2"
            style={{ color: "var(--gold-light)" }}
          >
            {copied ? "Copied" : "Copy my link"}
          </button>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              window.location.href = whatsappChatUrl(null, `My SendEbun organiser link (keep this private):\n${url()}`);
            }}
            className="text-xs underline underline-offset-2"
            style={{ color: "var(--gold-light)" }}
          >
            Save it to my WhatsApp
          </a>
        </div>
      </div>
    </section>
  );
}

/**
 * N days from now or from the deadline, whichever is later — once the
 * deadline has passed, "+1 day" means a day from now. Capped at a week
 * past the original deadline, the API's limit.
 */
function extendedDeadline(deadline: string, days: number): string {
  const current = new Date(deadline).getTime();
  const from = Math.max(current, Date.now());
  return new Date(Math.min(from + days * DAY, current + 7 * DAY)).toISOString();
}
