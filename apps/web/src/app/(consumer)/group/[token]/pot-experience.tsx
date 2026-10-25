"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { BrandLogo } from "@/components/brand-logo";
import { PolicyLinks } from "@/components/policy-links";
import { formatNaira, parseNairaToKobo } from "@/lib/format-money";
import { GroupGiftError, type ShareStatus, contribute, shareStatus } from "@/lib/group/api";
import { shareFee } from "@/lib/group/fee";
import type { GroupGiftPublicView } from "@/lib/group/types";
import { GiftCard, PotProgress, deadlineLabel, namesLine } from "../pot-parts";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MESSAGE_MAX = 280;
/** Common shares, in naira. Only the ones that fit what's left are offered. */
const PRESETS = [2_000, 5_000, 10_000];

/**
 * The page everyone in the WhatsApp group opens. Its job is to beat
 * "send to my account, then screenshot it": one screen, no account, the
 * fee in plain sight before paying, and a line for the recipient that a
 * bank transfer can't carry.
 *
 * Order on the screen is the order of the decision: what the gift is,
 * how close it is, who's already in, then your share.
 */
export function PotExperience({
  token,
  pot,
  returnedFromPayment,
  paymentReference,
}: {
  token: string;
  pot: GroupGiftPublicView;
  returnedFromPayment: boolean;
  /** Paystack's reference for the payment just made, from the return address. */
  paymentReference: string | null;
}) {
  const router = useRouter();
  const funded = pot.status === "funded";
  const recipient = pot.recipientFirstName;

  // Back from Paystack. ?paid=1 proves nothing — a share counts when
  // Paystack's webhook reaches the API — so the page asks the API about
  // this payment by its reference until it has an answer, and says
  // what's happening meanwhile.
  const [status, setStatus] = useState<ShareStatus | null>(null);
  const [tries, setTries] = useState(0);
  const settled = status !== null && status !== "pending";
  const watching = returnedFromPayment && paymentReference !== null && !settled && tries < 15;
  useEffect(() => {
    if (!watching || !paymentReference) return;
    const timer = setTimeout(
      async () => {
        const next = await shareStatus(token, paymentReference);
        setTries((n) => n + 1);
        setStatus(next);
        // Counted: pull the fresh pot (bar, names) into the page.
        if (next === "confirmed") router.refresh();
      },
      tries === 0 ? 300 : 2_500,
    );
    return () => clearTimeout(timer);
  }, [watching, tries, token, paymentReference, router]);
  const banner = returnBanner(returnedFromPayment, paymentReference, status, watching, recipient);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col px-7">
      <header className="flex items-center justify-between pt-5 pb-7">
        <BrandLogo size="sm" href={null} />
        {pot.status === "open" && (
          <p className="text-[11px] tracking-wide" style={{ color: "var(--cream-dim)" }}>
            {deadlineLabel(pot.deadline)}
          </p>
        )}
      </header>

      {banner && (
        <p
          role="status"
          className="mb-6 border px-4 py-3 text-xs leading-relaxed"
          style={{ borderColor: banner.good ? "var(--success)" : "var(--border-strong)", color: "var(--cream-dim)" }}
        >
          {banner.text}
        </p>
      )}

      <div className="pb-6">
        <h1 className="font-display text-3xl leading-tight font-normal" style={{ color: "var(--cream)" }}>
          {funded ? (
            <>
              {recipient}&rsquo;s gift is <span style={{ color: "var(--gold-light)" }}>fully paid for</span>.
            </>
          ) : (
            <>
              A gift for <span style={{ color: "var(--gold-light)" }}>{recipient}</span>, from all of you.
            </>
          )}
        </h1>
        {pot.organiserFirstName && !funded && (
          <p className="mt-2 text-sm" style={{ color: "var(--cream-dim)" }}>
            {pot.organiserFirstName} is putting it together. Add your share and a line for {recipient}.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-6 pb-6">
        <GiftCard gift={pot.gift} />
        <PotProgress
          raised={pot.amountRaised}
          target={pot.targetAmount}
          contributorCount={pot.contributorCount}
          funded={funded}
        />
        {pot.contributors.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Who has chipped in">
            {pot.contributors.map((c, i) => (
              <li
                key={`${c.name}-${i}`}
                className="border px-2.5 py-1 text-[11px]"
                style={{ borderColor: "var(--border)", color: "var(--cream-dim)" }}
              >
                {c.name}
                {c.amount !== null && <span style={{ color: "var(--gold-dim)" }}> · {formatNaira(c.amount)}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {pot.status === "awaiting_organiser" && (
        <Notice>
          The deadline has passed, but there&rsquo;s still time to help finish it while{" "}
          {pot.organiserFirstName ?? "the organiser"} decides. If the gift doesn&rsquo;t go ahead, everyone who
          paid gets their money back in full, automatically.
        </Notice>
      )}

      {(pot.status === "open" || pot.status === "awaiting_organiser") && <ContributeForm token={token} pot={pot} />}

      {pot.status === "closed" && (
        <Notice>
          This group gift has closed. Everyone who paid is being refunded in full, automatically, to the card or
          account they paid with.
        </Notice>
      )}

      {funded && (
        <div className="flex flex-col gap-4 pb-8">
          <p className="text-sm leading-relaxed" style={{ color: "var(--cream-dim)" }}>
            {namesLine(pot.contributors.map((c) => c.name)) || "Everyone"} made this happen.{" "}
            {recipient} gets the gift with everyone&rsquo;s names and messages.
          </p>
          {/* The loop: a contributor who just saw how easy that was is
              the likeliest next sender. */}
          <Link
            href="/send"
            className="w-full py-3.5 text-center text-sm font-medium tracking-wide"
            style={{ background: "var(--action)", color: "var(--ink)" }}
          >
            Send a gift of your own
          </Link>
        </div>
      )}

      <PolicyLinks className="mt-auto pt-6 pb-8" />
    </div>
  );
}

function ContributeForm({ token, pot }: { token: string; pot: GroupGiftPublicView }) {
  const recipient = pot.recipientFirstName;
  const remainingNaira = Math.floor(pot.remaining / 100);
  const minNaira = Math.ceil(pot.minContribution / 100);

  const presets = useMemo(() => {
    const fitting = PRESETS.filter((n) => n >= minNaira && n < remainingNaira);
    // "The rest" closes the pot in one tap — offered once it's a share
    // someone might actually cover.
    if (remainingNaira <= 50_000 && !fitting.includes(remainingNaira)) fitting.push(remainingNaira);
    return fitting;
  }, [minNaira, remainingNaira]);

  const [amountText, setAmountText] = useState(presets[0] ? String(presets[0]) : "");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [touchedEmail, setTouchedEmail] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const kobo = parseNairaToKobo(amountText);
  const wholeNaira = kobo !== null && kobo % 100 === 0 ? kobo / 100 : null;
  const amountError =
    amountText.trim() === ""
      ? null
      : wholeNaira === null
        ? "Whole naira only, e.g. 5000"
        : wholeNaira < minNaira
          ? `The smallest share is ${formatNaira(minNaira * 100)}`
          : wholeNaira > remainingNaira
            ? `Only ${formatNaira(pot.remaining)} is left to reach the target`
            : null;
  const amountOk = wholeNaira !== null && amountError === null;
  const fee = amountOk ? shareFee(wholeNaira * 100, pot.serviceFee) : 0;
  const emailOk = EMAIL_PATTERN.test(email.trim());
  const canPay = amountOk && name.trim().length > 0 && emailOk && !submitting;

  async function pay() {
    if (!canPay || wholeNaira === null) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await contribute(token, {
        name: name.trim(),
        email: email.trim(),
        amountNaira: wholeNaira,
        message: message.trim() || undefined,
      });
      window.location.href = result.checkoutUrl;
    } catch (e) {
      setError(e instanceof GroupGiftError ? e.message : "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="flex flex-col gap-7 pb-44">
        <section className="flex flex-col gap-3">
          <p className="text-xs" style={{ color: "var(--cream-dim)" }}>
            Your share
          </p>
          {presets.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {presets.map((n) => {
                const active = wholeNaira === n;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setAmountText(String(n))}
                    aria-pressed={active}
                    className="border px-3.5 py-2 text-xs transition-colors"
                    style={{
                      borderColor: active ? "var(--gold)" : "var(--border)",
                      background: active ? "var(--gold-glow)" : "transparent",
                      color: active ? "var(--gold-light)" : "var(--cream-dim)",
                    }}
                  >
                    {n === remainingNaira ? `The rest · ${formatNaira(n * 100)}` : formatNaira(n * 100)}
                  </button>
                );
              })}
            </div>
          )}
          <label className="flex items-baseline gap-2 border-b" style={{ borderColor: "var(--border-strong)" }}>
            <span className="text-lg" style={{ color: "var(--gold-dim)" }}>
              ₦
            </span>
            <input
              inputMode="numeric"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              placeholder="Any amount"
              aria-label="Your share in naira"
              className="w-full bg-transparent py-2 text-lg outline-none"
              style={{ color: "var(--cream)" }}
            />
          </label>
          {amountError && (
            <p className="text-[11px]" style={{ color: "var(--gold-light)" }}>
              {amountError}
            </p>
          )}
        </section>

        <section className="flex flex-col gap-4">
          <Field label={`A line for ${recipient} (optional)`}>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, MESSAGE_MAX))}
              rows={3}
              placeholder={`Happy birthday, ${recipient}!`}
              className="w-full resize-none border bg-transparent p-3 text-sm outline-none"
              style={{ borderColor: "var(--border)", color: "var(--cream)" }}
            />
            <span className="text-right text-[10px]" style={{ color: "var(--cream-faint)" }}>
              Only {recipient} sees this, when they open the gift · {message.length}/{MESSAGE_MAX}
            </span>
          </Field>
          <Field label="Your name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              placeholder="As they know you"
              autoComplete="name"
              className="w-full border-0 border-b bg-transparent py-2 text-sm outline-none"
              style={{ borderColor: "var(--border-strong)", color: "var(--cream)" }}
            />
          </Field>
          <Field
            label="Your email"
            error={touchedEmail && email.trim() && !emailOk ? "That doesn't look like a valid email" : undefined}
          >
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setTouchedEmail(true)}
              placeholder="you@example.com"
              autoComplete="email"
              className="w-full border-0 border-b bg-transparent py-2 text-sm outline-none"
              style={{ borderColor: "var(--border-strong)", color: "var(--cream)" }}
            />
          </Field>
          <p className="text-[11px] leading-relaxed" style={{ color: "var(--cream-faint)" }}>
            For your receipt, and for your refund if the gift doesn&rsquo;t go ahead. The group sees your first
            name only.
          </p>
        </section>
      </div>

      <div
        className="fixed inset-x-0 bottom-0 border-t px-7 pt-4"
        style={{
          borderColor: "var(--border)",
          background: "rgba(var(--sendebun-background-rgb), 0.95)",
          backdropFilter: "blur(16px)",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1.25rem)",
        }}
      >
        <div className="mx-auto max-w-[440px]">
          {error && (
            <p role="alert" className="mb-2 text-center text-xs" style={{ color: "var(--error)" }}>
              {error}
            </p>
          )}
          {amountOk && fee > 0 && (
            <p className="mb-2.5 text-center text-[11px]" style={{ color: "var(--cream-faint)" }}>
              {formatNaira(wholeNaira! * 100)} towards the gift + {formatNaira(fee)} service fee.{" "}
              <Link href="/refunds" target="_blank" className="underline underline-offset-2">
                Refund policy
              </Link>
            </p>
          )}
          <button
            type="button"
            onClick={() => void pay()}
            disabled={!canPay}
            className="w-full py-3.5 text-sm font-medium tracking-wide disabled:opacity-40"
            style={{ background: "var(--action)", color: "var(--ink)" }}
          >
            {submitting
              ? "Redirecting to Paystack…"
              : amountOk
                ? `Chip in ${formatNaira(wholeNaira! * 100 + fee)}`
                : "Chip in"}
          </button>
        </div>
      </div>
    </>
  );
}

function returnBanner(
  returned: boolean,
  reference: string | null,
  status: ShareStatus | null,
  watching: boolean,
  recipient: string,
): { text: string; good: boolean } | null {
  if (!returned) return null;
  if (status === "confirmed")
    return { text: `You're in. Thank you — ${recipient} will see your name on the gift.`, good: true };
  if (status === "late" || status === "refunded")
    return {
      text: "The gift filled up just before your payment landed, so you're being refunded in full — nothing to do.",
      good: false,
    };
  if (status === "failed") return { text: "That payment didn't go through. You can try again below.", good: false };
  if (reference && watching) return { text: "Payment received by Paystack. Confirming your share…", good: false };
  return {
    text: "If you paid, your share will show here shortly. Paystack has emailed you a receipt.",
    good: false,
  };
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="mb-8 border px-4 py-3 text-sm leading-relaxed"
      style={{ borderColor: "var(--border-strong)", color: "var(--cream-dim)" }}
    >
      {children}
    </p>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs" style={{ color: "var(--cream-dim)" }}>
        {label}
      </span>
      {children}
      {error && (
        <span className="text-[11px]" style={{ color: "var(--gold-light)" }}>
          {error}
        </span>
      )}
    </label>
  );
}
