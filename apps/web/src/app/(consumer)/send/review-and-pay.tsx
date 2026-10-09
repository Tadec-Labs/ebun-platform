"use client";

import { useState } from "react";
import { CreateOrderError, createOrder } from "@/lib/orders/create-order";
import { formatNaira } from "@/lib/format-money";
import type { GiftCatalogItem } from "@/lib/gifts/types";
import type { MessageDraft } from "./compose";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The last step: who's paying, and how much.
 *
 * The summary is short on purpose. The sender has just come from a
 * screen that showed them the recipient's whole experience, message
 * included — repeating it line by line here is a second review of
 * something already reviewed, and every row is one more thing between
 * a decided sender and Paystack.
 */
export function ReviewAndPay({
  gift,
  message,
  onBack,
}: {
  gift: GiftCatalogItem;
  message: MessageDraft;
  onBack: () => void;
}) {
  const [senderName, setSenderName] = useState("");
  const [senderEmail, setSenderEmail] = useState("");
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailIsValid = EMAIL_PATTERN.test(senderEmail.trim());
  const canSubmit = senderName.trim().length > 0 && emailIsValid;

  async function handlePay() {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      const result = await createOrder({
        giftTemplateId: gift.id,
        recipientName: message.recipientName.trim(),
        recipientPhone: message.recipientPhone.trim(),
        senderName: senderName.trim(),
        senderEmail: senderEmail.trim(),
        senderMessage: message.text.trim() || undefined,
        messageType: "text",
        scheduledSendAt:
          message.sendTiming === "scheduled" && message.scheduledFor
            ? new Date(message.scheduledFor).toISOString()
            : undefined,
      });
      // Real redirect to Paystack's hosted checkout — this is the
      // actual payment, not a mock. Nothing to do after this beyond
      // leaving the page; Paystack returns the sender to
      // WEB_APP_BASE_URL's configured callback once they've paid (or
      // abandoned), independent of this component's lifecycle.
      window.location.href = result.checkoutUrl;
    } catch (e) {
      setError(
        e instanceof CreateOrderError
          ? e.message
          : "Something went wrong. Please try again.",
      );
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
          Last step.
        </h1>
        <p className="mt-2 text-sm" style={{ color: "var(--cream-dim)" }}>
          We need these for your receipt.
        </p>
      </div>

      <div className="flex flex-col gap-8 pb-40">
        <section
          className="flex flex-col gap-3 border p-4"
          style={{ borderColor: "var(--border)" }}
        >
          <SummaryRow label="Sending" value={gift.name} />
          <SummaryRow
            label="To"
            value={`${message.recipientName} · ${message.recipientPhone}`}
          />
          {message.sendTiming === "scheduled" && message.scheduledFor && (
            <SummaryRow
              label="Arrives"
              value={new Date(message.scheduledFor).toLocaleString("en-NG", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            />
          )}
          <div
            className="mt-1 flex items-baseline justify-between border-t pt-3"
            style={{ borderColor: "var(--border)" }}
          >
            <span className="text-xs uppercase tracking-wide" style={{ color: "var(--gold-dim)" }}>
              Total
            </span>
            <span className="font-display text-2xl" style={{ color: "var(--gold-light)" }}>
              {formatNaira(gift.basePrice)}
            </span>
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <Field label="Your name">
            <input
              value={senderName}
              onChange={(e) => setSenderName(e.target.value)}
              maxLength={200}
              placeholder="Segun"
              className="w-full border-0 border-b bg-transparent py-2 text-sm outline-none"
              style={{ borderColor: "var(--border-strong)", color: "var(--cream)" }}
            />
          </Field>
          <Field
            label="Your email"
            error={
              touched && senderEmail.trim().length > 0 && !emailIsValid
                ? "That doesn't look like a valid email"
                : undefined
            }
          >
            <input
              type="email"
              value={senderEmail}
              onChange={(e) => setSenderEmail(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder="you@example.com"
              className="w-full border-0 border-b bg-transparent py-2 text-sm outline-none"
              style={{ borderColor: "var(--border-strong)", color: "var(--cream)" }}
            />
          </Field>
          <p className="text-[11px] leading-relaxed" style={{ color: "var(--cream-faint)" }}>
            Your receipt goes here. We don&rsquo;t share it with the recipient.
          </p>
        </section>
      </div>

      <div
        className="fixed inset-x-0 bottom-0 border-t px-7 pt-4"
        style={{
          borderColor: "var(--border)",
          background: "rgba(14, 13, 11, 0.95)",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1.25rem)",
        }}
      >
        <div className="mx-auto max-w-[440px]">
          {error && (
            <p className="mb-2 text-center text-xs" style={{ color: "#e08a8a" }}>
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={() => void handlePay()}
            disabled={!canSubmit || submitting}
            className="w-full py-3.5 text-sm font-medium tracking-wide disabled:opacity-40"
            style={{ background: "var(--gold)", color: "var(--ink)" }}
          >
            {submitting ? "Redirecting to Paystack…" : `Pay ${formatNaira(gift.basePrice)}`}
          </button>
        </div>
      </div>
    </>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span style={{ color: "var(--cream-dim)" }}>{label}</span>
      <span className="text-right" style={{ color: "var(--cream)" }}>
        {value}
      </span>
    </div>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
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
