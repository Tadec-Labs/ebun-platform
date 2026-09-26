"use client";

import { useState } from "react";
import { LockGlyph } from "@/components/icons";
import type { GiftCatalogItem } from "@/lib/gifts/types";

export type MessageType = "text" | "voice" | "video";
export type SendTiming = "now" | "scheduled";

export interface MessageDraft {
  recipientName: string;
  recipientPhone: string;
  text: string;
  sendTiming: SendTiming;
  scheduledFor: string; // datetime-local string, only meaningful when sendTiming === "scheduled"
}

// Mirrors apps/api/src/orders/dto's PHONE_PATTERN exactly — keep these
// in sync. Client-side validation here is for immediate feedback only;
// the backend re-validates regardless and is the actual authority.
const PHONE_PATTERN = /^\+[1-9]\d{6,14}$/;
const MESSAGE_MAX_LENGTH = 2000;

export function MessageComposer({
  gift,
  draft,
  onChangeDraft,
  onBack,
}: {
  gift: GiftCatalogItem;
  draft: MessageDraft;
  onChangeDraft: (draft: MessageDraft) => void;
  onBack: () => void;
}) {
  const [touchedPhone, setTouchedPhone] = useState(false);
  const phoneIsValid = PHONE_PATTERN.test(draft.recipientPhone.trim());
  const canContinue = draft.recipientName.trim().length > 0 && phoneIsValid;

  function set<K extends keyof MessageDraft>(key: K, value: MessageDraft[K]) {
    onChangeDraft({ ...draft, [key]: value });
  }

  return (
    <>
      <button
        type="button"
        onClick={onBack}
        className="mb-2 self-start text-xs tracking-wide"
        style={{ color: "var(--cream-dim)" }}
      >
        ← Change gift
      </button>

      <div className="flex flex-col gap-1.5 pb-7 text-center">
        <h1 className="font-display text-3xl font-normal" style={{ color: "var(--cream)" }}>
          Add your message
        </h1>
        <p className="text-sm" style={{ color: "var(--cream-dim)" }}>
          Sending {gift.name}
        </p>
      </div>

      <div className="flex flex-col gap-8 pb-40">
        <section className="flex flex-col gap-4">
          <h2 className="text-[11px] tracking-wide uppercase" style={{ color: "var(--gold-dim)" }}>
            Who&rsquo;s it for
          </h2>
          <Field label="Recipient's name">
            <input
              value={draft.recipientName}
              onChange={(e) => set("recipientName", e.target.value)}
              maxLength={200}
              placeholder="Ada"
              className="w-full border-0 border-b bg-transparent py-2 text-sm outline-none"
              style={{ borderColor: "var(--border-strong)", color: "var(--cream)" }}
            />
          </Field>
          <Field
            label="WhatsApp number"
            error={
              touchedPhone && draft.recipientPhone.trim().length > 0 && !phoneIsValid
                ? "Include the country code, e.g. +2348012345678"
                : undefined
            }
          >
            <input
              value={draft.recipientPhone}
              onChange={(e) => set("recipientPhone", e.target.value)}
              onBlur={() => setTouchedPhone(true)}
              placeholder="+2348012345678"
              inputMode="tel"
              className="w-full border-0 border-b bg-transparent py-2 text-sm outline-none"
              style={{ borderColor: "var(--border-strong)", color: "var(--cream)" }}
            />
          </Field>
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-[11px] tracking-wide uppercase" style={{ color: "var(--gold-dim)" }}>
            Your message
          </h2>
          <MessageTypeTabs />
          <textarea
            value={draft.text}
            onChange={(e) => set("text", e.target.value.slice(0, MESSAGE_MAX_LENGTH))}
            rows={5}
            placeholder="Write what you'd say if you were there..."
            className="w-full resize-none border bg-transparent p-4 text-sm outline-none"
            style={{ borderColor: "var(--border)", color: "var(--cream)" }}
          />
          <p className="text-right text-[10px]" style={{ color: "var(--cream-faint)" }}>
            {draft.text.length}/{MESSAGE_MAX_LENGTH}
          </p>
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-[11px] tracking-wide uppercase" style={{ color: "var(--gold-dim)" }}>
            When should it land
          </h2>
          <div className="flex gap-2">
            <TimingOption
              label="Send now"
              active={draft.sendTiming === "now"}
              onClick={() => set("sendTiming", "now")}
            />
            <TimingOption
              label="Schedule"
              active={draft.sendTiming === "scheduled"}
              onClick={() => set("sendTiming", "scheduled")}
            />
          </div>
          {draft.sendTiming === "scheduled" && (
            <input
              type="datetime-local"
              value={draft.scheduledFor}
              onChange={(e) => set("scheduledFor", e.target.value)}
              className="w-full border bg-transparent p-3 text-sm outline-none"
              style={{ borderColor: "var(--border-strong)", color: "var(--cream)", colorScheme: "dark" }}
            />
          )}
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
          <button
            type="button"
            disabled
            className="w-full py-3.5 text-sm font-medium tracking-wide opacity-40"
            style={{ background: "var(--gold)", color: "var(--ink)" }}
          >
            Continue to payment
          </button>
          <p
            className="mt-2 text-center text-[10px] leading-relaxed"
            style={{ color: "var(--cream-faint)" }}
          >
            {canContinue
              ? "Review and payment aren't built yet — this is as far as it goes for now."
              : "Fill in the recipient's name and a valid WhatsApp number to continue."}
          </p>
        </div>
      </div>
    </>
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

function MessageTypeTabs() {
  return (
    <div className="flex gap-2">
      <TabButton label="Text" active />
      <TabButton label="Voice" locked />
      <TabButton label="Video" locked />
    </div>
  );
}

function TabButton({
  label,
  active,
  locked,
}: {
  label: string;
  active?: boolean;
  locked?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={locked}
      title={locked ? "Recording isn't built yet — text only, for now" : undefined}
      className="flex flex-1 items-center justify-center gap-1.5 border py-2.5 text-xs tracking-wide"
      style={{
        borderColor: active ? "var(--gold)" : "var(--border)",
        color: active ? "var(--gold-light)" : "var(--cream-faint)",
        opacity: locked ? 0.6 : 1,
      }}
    >
      {locked && <LockGlyph className="h-3 w-3" />}
      {label}
    </button>
  );
}

function TimingOption({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 border py-2.5 text-xs tracking-wide"
      style={{
        borderColor: active ? "var(--gold)" : "var(--border)",
        color: active ? "var(--gold-light)" : "var(--cream-faint)",
      }}
    >
      {label}
    </button>
  );
}
