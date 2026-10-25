"use client";

import Link from "next/link";
import { useState } from "react";
import { formatNaira } from "@/lib/format-money";
import type { GiftCatalogItem } from "@/lib/gifts/types";
import { GroupGiftError, createGroupGift } from "@/lib/group/api";
import type { MessageDraft } from "./compose";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HOUR = 3_600_000;

type DeadlineChoice = "2d" | "7d" | "custom";

/**
 * The last step when chipping in with friends: instead of paying, the
 * organiser sets a deadline and gets a link for the group. Nothing is
 * charged here — the organiser chips in on the pot page like everyone
 * else, if they want to.
 *
 * Same shape as the pay step on purpose (summary, two fields, one
 * button), so choosing "with friends" never feels like a different app.
 */
export function StartGroupGift({
  gift,
  message,
  onBack,
}: {
  gift: GiftCatalogItem;
  message: MessageDraft;
  onBack: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [touchedEmail, setTouchedEmail] = useState(false);
  const [deadlineChoice, setDeadlineChoice] = useState<DeadlineChoice>("2d");
  const [customDeadline, setCustomDeadline] = useState("");
  const [showAmounts, setShowAmounts] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const target = gift.basePrice + gift.deliveryFee;
  const recipient = message.recipientName.trim().split(/\s+/)[0] || "them";
  const deadline = resolveDeadline(deadlineChoice, customDeadline);
  const emailOk = EMAIL_PATTERN.test(email.trim());
  const canCreate = name.trim().length > 0 && emailOk && deadline !== null && !submitting;

  async function create() {
    if (!canCreate || !deadline) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await createGroupGift({
        giftTemplateId: gift.id,
        organiserName: name.trim(),
        organiserEmail: email.trim(),
        recipientName: message.recipientName.trim(),
        recipientPhone: message.recipientPhone.trim(),
        message: message.text.trim() || undefined,
        deadline,
        sendAt:
          message.sendTiming === "scheduled" && message.scheduledFor
            ? new Date(message.scheduledFor).toISOString()
            : undefined,
        showAmounts,
      });
      // The organiser link: the route behind it keeps the token in a
      // cookie and lands on the clean organiser page, share button first.
      window.location.href = result.managePath;
    } catch (e) {
      setError(e instanceof GroupGiftError ? e.message : "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={onBack}
        className="mb-5 self-start text-xs tracking-wide transition-colors hover:text-[color:var(--cream)]"
        style={{ color: "var(--cream-dim)" }}
      >
        ← Back to your message
      </button>

      <div className="pb-7">
        <h1 className="font-display text-3xl leading-tight font-normal" style={{ color: "var(--cream)" }}>
          Set up the group.
        </h1>
        <p className="mt-2 text-sm" style={{ color: "var(--cream-dim)" }}>
          You&rsquo;ll get one link to drop in your WhatsApp group.
        </p>
      </div>

      <div className="flex flex-col gap-8 pb-40">
        <section className="flex flex-col gap-3 border p-4" style={{ borderColor: "var(--border)" }}>
          <Row label="Gift" value={gift.name} />
          <Row label="For" value={`${message.recipientName} · ${message.recipientPhone}`} />
          <div className="flex items-baseline justify-between border-t pt-3" style={{ borderColor: "var(--border)" }}>
            <span className="text-xs uppercase tracking-wide" style={{ color: "var(--gold-dim)" }}>
              To raise
            </span>
            <span className="font-display text-2xl" style={{ color: "var(--gold-light)" }}>
              {formatNaira(target)}
            </span>
          </div>
          <p className="text-[11px] leading-relaxed" style={{ color: "var(--cream-faint)" }}>
            The gift at the partner&rsquo;s own price{gift.deliveryFee > 0 ? ", plus delivery" : ""}. Each person
            sees a small service fee on their own share before they pay.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <p className="text-xs" style={{ color: "var(--cream-dim)" }}>
            When should chipping in close?
          </p>
          <div className="flex gap-2">
            <Choice label="In 2 days" active={deadlineChoice === "2d"} onClick={() => setDeadlineChoice("2d")} />
            <Choice label="In a week" active={deadlineChoice === "7d"} onClick={() => setDeadlineChoice("7d")} />
            <Choice label="Pick a time" active={deadlineChoice === "custom"} onClick={() => setDeadlineChoice("custom")} />
          </div>
          {deadlineChoice === "custom" && (
            <input
              type="datetime-local"
              value={customDeadline}
              onChange={(e) => setCustomDeadline(e.target.value)}
              className="w-full border bg-transparent p-3 text-sm outline-none"
              style={{ borderColor: "var(--border-strong)", color: "var(--cream)", colorScheme: "dark" }}
            />
          )}
          {deadlineChoice === "custom" && customDeadline && !deadline && (
            <p className="text-[11px]" style={{ color: "var(--gold-light)" }}>
              Pick a time between an hour and 30 days from now.
            </p>
          )}
          <p className="text-[11px] leading-relaxed" style={{ color: "var(--cream-faint)" }}>
            If it&rsquo;s fully paid for sooner, it goes to {recipient} straight away. If it falls short, you choose:
            more time, a gift the pot covers, or refunds for everyone.
          </p>
        </section>

        <section className="flex flex-col gap-4">
          <Field label="Your name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              placeholder="As the group knows you"
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
          <label className="flex items-center gap-3 text-xs" style={{ color: "var(--cream-dim)" }}>
            <input
              type="checkbox"
              checked={showAmounts}
              onChange={(e) => setShowAmounts(e.target.checked)}
              className="h-4 w-4 accent-[color:var(--gold)]"
            />
            Let everyone see how much each person gave
          </label>
          <p className="text-[11px] leading-relaxed" style={{ color: "var(--cream-faint)" }}>
            Off by default: the group sees names, not amounts — nobody feels small for giving what they can.
          </p>
        </section>
      </div>

      <div
        className="fixed inset-x-0 bottom-0 border-t px-7 pt-4"
        style={{
          borderColor: "var(--border)",
          background: "rgba(var(--sendebun-background-rgb), 0.95)",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1.25rem)",
        }}
      >
        <div className="mx-auto max-w-[440px]">
          {error && (
            <p role="alert" className="mb-2 text-center text-xs" style={{ color: "var(--error)" }}>
              {error}
            </p>
          )}
          <p className="mb-2.5 text-center text-[11px] leading-relaxed" style={{ color: "var(--cream-faint)" }}>
            Nothing is charged now. See our{" "}
            <Link href="/terms" target="_blank" className="underline underline-offset-2">
              Terms
            </Link>{" "}
            and{" "}
            <Link href="/refunds" target="_blank" className="underline underline-offset-2">
              Refund policy
            </Link>
            .
          </p>
          <button
            type="button"
            onClick={() => void create()}
            disabled={!canCreate}
            className="w-full py-3.5 text-sm font-medium tracking-wide disabled:opacity-40"
            style={{ background: "var(--action)", color: "var(--ink)" }}
          >
            {submitting ? "Setting it up…" : "Create the group link"}
          </button>
        </div>
      </div>
    </>
  );
}

/** ISO deadline, or null when a custom time is missing or outside an hour–30 days (the API's limits). */
function resolveDeadline(choice: DeadlineChoice, custom: string): string | null {
  const now = Date.now();
  if (choice === "2d") return new Date(now + 48 * HOUR).toISOString();
  if (choice === "7d") return new Date(now + 7 * 24 * HOUR).toISOString();
  if (!custom) return null;
  const at = new Date(custom).getTime();
  if (Number.isNaN(at) || at < now + HOUR + 60_000 || at > now + 30 * 24 * HOUR) return null;
  return new Date(at).toISOString();
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span style={{ color: "var(--cream-dim)" }}>{label}</span>
      <span className="text-right" style={{ color: "var(--cream)" }}>
        {value}
      </span>
    </div>
  );
}

function Choice({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="flex-1 border py-2.5 text-xs tracking-wide transition-colors"
      style={{
        borderColor: active ? "var(--gold)" : "var(--border)",
        background: active ? "var(--gold-glow)" : "transparent",
        color: active ? "var(--gold-light)" : "var(--cream-faint)",
      }}
    >
      {label}
    </button>
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
