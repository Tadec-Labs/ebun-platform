"use client";

import Link from "next/link";
import { useState } from "react";
import { FulfillmentType } from "@ebun/types";
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

    const recorded =
      (message.messageType === "voice" || message.messageType === "video") && message.recordedMedia
        ? message.recordedMedia
        : null;

    try {
      const result = await createOrder(
        {
          giftTemplateId: gift.id,
          recipientName: message.recipientName.trim(),
          recipientPhone: message.recipientPhone.trim(),
          senderName: senderName.trim(),
          senderEmail: senderEmail.trim(),
          // Text left over from the Write tab isn't sent with a recording:
          // the sender never saw it as part of that message.
          senderMessage: recorded ? undefined : message.text.trim() || undefined,
          messageType: recorded ? (message.messageType as "voice" | "video") : "text",
          scheduledSendAt:
            message.sendTiming === "scheduled" && message.scheduledFor
              ? new Date(message.scheduledFor).toISOString()
              : undefined,
        },
        recorded ? { blob: recorded.blob, durationSecs: recorded.durationSecs } : undefined,
      );
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
          {/* The fee is its own line on purpose: the gift costs what it
              costs at the counter, and the sender can see that. */}
          <div
            className="mt-1 flex flex-col gap-2 border-t pt-3"
            style={{ borderColor: "var(--border)" }}
          >
            <SummaryRow label="Gift" value={formatNaira(gift.basePrice)} />
            {gift.deliveryFee > 0 && (
              <SummaryRow label="Delivery to their door" value={formatNaira(gift.deliveryFee)} />
            )}
            {gift.serviceFee > 0 && (
              <SummaryRow label="Service fee" value={formatNaira(gift.serviceFee)} />
            )}
          </div>
          {gift.deliveryType === FulfillmentType.Physical && (
            // Answers the question every sender of a hamper has: "but I
            // didn't give an address". They don't need one.
            <p className="text-xs leading-relaxed" style={{ color: "var(--cream-dim)" }}>
              No address needed from you. {message.recipientName || "They"} will tell us where to bring it when they
              open the gift — the surprise stays intact.
            </p>
          )}
          <div
            className="flex items-baseline justify-between border-t pt-3"
            style={{ borderColor: "var(--border)" }}
          >
            <span className="text-xs uppercase tracking-wide" style={{ color: "var(--gold-dim)" }}>
              Total
            </span>
            <span className="font-display text-2xl" style={{ color: "var(--gold-light)" }}>
              {formatNaira(gift.totalPrice)}
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
          background: "rgba(var(--sendebun-background-rgb), 0.95)",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1.25rem)",
        }}
      >
        <div className="mx-auto max-w-[440px]">
          {error && (
            <p className="mb-2 text-center text-xs" style={{ color: "var(--error)" }}>
              {error}
              {/* A recording that won't save must never stand between a
                  sender and paying: offer the way out, not just "try again". */}
              {message.messageType !== "text" && message.recordedMedia && (
                <>
                  {" "}
                  <button type="button" onClick={onBack} className="underline underline-offset-2">
                    Write your message instead
                  </button>
                </>
              )}
            </p>
          )}
          {/* Above the button, not under it: read before paying, which
              is what makes it agreement rather than small print. */}
          <p className="mb-2.5 text-center text-[11px] leading-relaxed" style={{ color: "var(--cream-faint)" }}>
            By paying you agree to our{" "}
            <Link href="/terms" target="_blank" className="underline underline-offset-2">
              Terms
            </Link>{" "}
            and{" "}
            <Link href="/refunds" target="_blank" className="underline underline-offset-2">
              Refund policy
            </Link>
            . How we use your and the recipient&rsquo;s details:{" "}
            <Link href="/privacy" target="_blank" className="underline underline-offset-2">
              Privacy
            </Link>
            .
          </p>
          <button
            type="button"
            onClick={() => void handlePay()}
            disabled={!canSubmit || submitting}
            className="w-full py-3.5 text-sm font-medium tracking-wide disabled:opacity-40"
            style={{ background: "var(--action)", color: "var(--ink)" }}
          >
            {submitting
              ? message.recordedMedia && message.messageType !== "text"
                ? "Sending your recording…"
                : "Redirecting to Paystack…"
              : `Pay ${formatNaira(gift.totalPrice)}`}
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
