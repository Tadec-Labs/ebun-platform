"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandLogo } from "@/components/brand-logo";
import { GiftMark } from "@/components/icons";
import { PolicyLinks } from "@/components/policy-links";
import { EVENT_COPY, formatEventDate } from "@/lib/events/copy";
import { type CashGiftStatus, EventError, cashGiftStatus, giveCash } from "@/lib/events/api";
import type { EventItemView, EventPublicView } from "@/lib/events/types";
import { formatNaira, parseNairaToKobo } from "@/lib/format-money";
import { shareFee } from "@/lib/group/fee";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MESSAGE_MAX = 280;
const PRESETS = [1_000, 2_000, 5_000, 10_000, 20_000, 50_000];

/**
 * E2 + E3 · The page every guest opens, at the venue or from abroad:
 * who it's for, then the two ways to give. The gift list hands over to
 * the existing pot page (give it whole or chip in); cash is paid here.
 */
export function EventExperience({
  event,
  returnedFromPayment,
  paymentReference,
}: {
  event: EventPublicView;
  returnedFromPayment: boolean;
  paymentReference: string | null;
}) {
  const router = useRouter();
  const copy = EVENT_COPY[event.eventType];
  const hasGifts = event.giftListEnabled && event.items.length > 0;
  const [tab, setTab] = useState<"gifts" | "cash">(hasGifts || !event.cashOpen ? "gifts" : "cash");

  // Back from Paystack: ask the API about this one payment until it has
  // an answer. ?paid=1 proves nothing on its own.
  const [status, setStatus] = useState<CashGiftStatus | null>(null);
  const [tries, setTries] = useState(0);
  const settled = status !== null && status !== "pending";
  const watching = returnedFromPayment && paymentReference !== null && !settled && tries < 15;
  useEffect(() => {
    if (!watching || !paymentReference) return;
    const timer = setTimeout(
      async () => {
        const next = await cashGiftStatus(event.slug, paymentReference);
        setTries((n) => n + 1);
        setStatus(next);
        if (next === "confirmed") router.refresh();
      },
      tries === 0 ? 300 : 2_500,
    );
    return () => clearTimeout(timer);
  }, [watching, tries, event.slug, paymentReference, router]);
  const banner = returnBanner(returnedFromPayment, paymentReference, status, watching);

  const giving = event.status === "active";

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col px-7">
      <header className="flex items-center justify-between pt-5 pb-7">
        <BrandLogo size="sm" href={null} />
        <p className="border px-2.5 py-1 text-[11px]" style={{ borderColor: "var(--border)", color: "var(--cream-dim)" }}>
          {formatEventDate(event.eventDate)} · {event.city}
        </p>
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

      <div className="flex flex-col items-center gap-2 pb-7 text-center">
        <p className="text-[11px] tracking-[0.16em] uppercase" style={{ color: "var(--gold)" }}>
          {copy.eyebrow}
        </p>
        <h1 className="font-display text-4xl leading-tight font-normal" style={{ color: "var(--cream)" }}>
          {event.title}
        </h1>
        {event.guestCount > 0 && (
          <p className="text-xs" style={{ color: "var(--cream-dim)" }}>
            {event.guestCount} gave
          </p>
        )}
      </div>

      {event.status === "cancelled" && (
        <Notice>Cancelled. Everyone is refunded automatically.</Notice>
      )}
      {event.status === "closed" && (
        <Notice>Giving has closed. Thank you.</Notice>
      )}

      {giving && (hasGifts || event.cashOpen) && (
        <>
          {hasGifts && event.cashOpen && (
            <div role="tablist" className="mb-6 grid grid-cols-2 gap-1.5 p-1" style={{ background: "var(--panel)" }}>
              <TabButton active={tab === "gifts"} onClick={() => setTab("gifts")}>
                Gift list
              </TabButton>
              <TabButton active={tab === "cash"} onClick={() => setTab("cash")}>
                {copy.cash}
              </TabButton>
            </div>
          )}
          {tab === "gifts" && hasGifts && <GiftList items={event.items} />}
          {(tab === "cash" || !hasGifts) && event.cashOpen && <CashForm event={event} />}
        </>
      )}

      {giving && !hasGifts && !event.cashOpen && (
        <Notice>Opening soon.</Notice>
      )}

      <PolicyLinks className="mt-auto pt-6 pb-8" />
    </div>
  );
}

function GiftList({ items }: { items: EventItemView[] }) {
  return (
    <ul className="flex flex-col gap-2.5 pb-10" aria-label="Gift list">
      {items.map((item) => {
        const percent = item.price > 0 ? Math.min(100, Math.round((item.raised / item.price) * 100)) : 0;
        const partly = item.status === "open" && item.raised > 0;
        return (
          <li
            key={item.token}
            className="flex items-center gap-3 border p-3"
            style={{ borderColor: "var(--border)", background: "var(--panel)", opacity: item.status === "open" ? 1 : 0.7 }}
          >
            <div
              className="flex h-14 w-14 flex-shrink-0 items-center justify-center overflow-hidden"
              style={{ background: "var(--panel-raised)" }}
            >
              {item.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.imageUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <GiftMark className="h-6 w-6 text-[color:var(--gold-dim)]" />
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="truncate text-sm" style={{ color: "var(--cream)" }}>
                {item.name}
              </p>
              {item.status === "given" ? (
                <p className="text-[11px]" style={{ color: "var(--success)" }}>
                  {item.givenBy.length > 0 ? `Given · ${item.givenBy.join(", ")}` : "Given"}
                </p>
              ) : item.status === "closed" ? (
                <p className="text-[11px]" style={{ color: "var(--cream-faint)" }}>
                  Closed
                </p>
              ) : partly ? (
                <>
                  <div className="h-1.5 w-full" style={{ background: "var(--panel-raised)" }}>
                    <div className="h-full" style={{ width: `${percent}%`, background: "var(--gold)" }} />
                  </div>
                  <p className="text-[11px]" style={{ color: "var(--cream-dim)" }}>
                    {formatNaira(item.raised)} / {formatNaira(item.price)}
                  </p>
                </>
              ) : (
                <p className="text-[11px]" style={{ color: "var(--cream-dim)" }}>
                  {formatNaira(item.price)}
                </p>
              )}
            </div>
            {item.status === "open" && (
              <Link
                // "Give" opens the pot with the whole amount ready; "Chip in" with a share.
                href={partly ? `/group/${item.token}` : `/group/${item.token}?full=1`}
                className="flex-shrink-0 px-3.5 py-2.5 text-xs font-medium"
                style={
                  partly
                    ? { background: "var(--panel-raised)", color: "var(--gold-light)" }
                    : { background: "var(--gold)", color: "var(--ink)" }
                }
              >
                {partly ? "Chip in" : "Give"}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function CashForm({ event }: { event: EventPublicView }) {
  const copy = EVENT_COPY[event.eventType];
  const minNaira = Math.ceil(event.minCash / 100);
  const [amountText, setAmountText] = useState("5000");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [onWall, setOnWall] = useState(true);
  const [showAmount, setShowAmount] = useState(false);
  const [touchedEmail, setTouchedEmail] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const kobo = parseNairaToKobo(amountText);
  const wholeNaira = kobo !== null && kobo % 100 === 0 ? kobo / 100 : null;
  const amountError =
    amountText.trim() === ""
      ? null
      : wholeNaira === null
        ? "Whole naira"
        : wholeNaira < minNaira
          ? `Min ${formatNaira(minNaira * 100)}`
          : null;
  const amountOk = wholeNaira !== null && amountError === null;
  const fee = amountOk ? shareFee(wholeNaira * 100, event.serviceFee) : 0;
  const emailOk = EMAIL_PATTERN.test(email.trim());
  const canPay = amountOk && name.trim().length > 0 && emailOk && !submitting;

  async function pay() {
    if (!canPay || wholeNaira === null) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await giveCash(event.slug, {
        name: name.trim(),
        email: email.trim(),
        amountNaira: wholeNaira,
        message: message.trim() || undefined,
        showOnWall: event.wallEnabled ? onWall : false,
        showAmount: event.showAmounts ? showAmount : false,
      });
      window.location.href = result.checkoutUrl;
    } catch (e) {
      setError(e instanceof EventError ? e.message : "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="flex flex-col gap-7 pb-44">
        <section className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-2">
            {PRESETS.map((n) => {
              const active = wholeNaira === n;
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => setAmountText(String(n))}
                  aria-pressed={active}
                  className="border py-3 text-sm transition-colors"
                  style={{
                    borderColor: active ? "var(--gold)" : "var(--border)",
                    background: active ? "var(--gold-glow)" : "transparent",
                    color: active ? "var(--gold-light)" : "var(--cream)",
                  }}
                >
                  {formatNaira(n * 100)}
                </button>
              );
            })}
          </div>
          <label className="flex items-baseline gap-2 border-b" style={{ borderColor: "var(--border-strong)" }}>
            <span className="text-lg" style={{ color: "var(--gold-dim)" }}>
              ₦
            </span>
            <input
              inputMode="numeric"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              placeholder="Any amount"
              aria-label="Amount in naira"
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
          <Field label="Your name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              autoComplete="name"
              className="w-full border-0 border-b bg-transparent py-2 text-sm outline-none"
              style={{ borderColor: "var(--border-strong)", color: "var(--cream)" }}
            />
          </Field>
          <Field label="Message (optional)">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, MESSAGE_MAX))}
              rows={3}
              className="w-full resize-none border bg-transparent p-3 text-sm outline-none"
              style={{ borderColor: "var(--border)", color: "var(--cream)" }}
            />

          </Field>
          <Field
            label="Email"
            error={touchedEmail && email.trim() && !emailOk ? "Check the email" : undefined}
          >
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setTouchedEmail(true)}
              autoComplete="email"
              placeholder="For your receipt"
              className="w-full border-0 border-b bg-transparent py-2 text-sm outline-none"
              style={{ borderColor: "var(--border-strong)", color: "var(--cream)" }}
            />
          </Field>
          {event.wallEnabled && (
            <Check checked={onWall} onChange={setOnWall}>
              On the {copy.wall.toLowerCase()}
            </Check>
          )}
          {event.showAmounts && (
            <Check checked={showAmount} onChange={setShowAmount}>
              Show amount
            </Check>
          )}
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
              {formatNaira(wholeNaira! * 100)} + {formatNaira(fee)} fee ·{" "}
              <Link href="/refunds" target="_blank" className="underline underline-offset-2">
                Refunds
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
              ? "Opening Paystack…"
              : amountOk
                ? `${copy.cashVerb} ${formatNaira(wholeNaira! * 100 + fee)}`
                : copy.cashVerb}
          </button>
        </div>
      </div>
    </>
  );
}

function returnBanner(
  returned: boolean,
  reference: string | null,
  status: CashGiftStatus | null,
  watching: boolean,
): { text: string; good: boolean } | null {
  if (!returned) return null;
  if (status === "confirmed") return { text: "Received. Thank you.", good: true };
  if (status === "late" || status === "refunded") return { text: "Couldn't be accepted — you're refunded in full.", good: false };
  if (status === "failed") return { text: "Payment didn't go through. Try again.", good: false };
  if (reference && watching) return { text: "Confirming…", good: false };
  return { text: "Your gift will show here shortly.", good: false };
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className="py-2.5 text-sm"
      style={{
        background: active ? "var(--panel-raised)" : "transparent",
        color: active ? "var(--gold-light)" : "var(--cream-dim)",
        fontWeight: active ? 500 : 400,
      }}
    >
      {children}
    </button>
  );
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm" style={{ color: "var(--cream)" }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-5 w-5"
        style={{ accentColor: "var(--gold)" }}
      />
      {children}
    </label>
  );
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
