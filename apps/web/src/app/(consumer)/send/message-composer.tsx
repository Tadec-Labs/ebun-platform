"use client";

import { useState } from "react";
import type { RecordedMedia } from "@/lib/media-recording/use-media-recorder";
import type { GiftCatalogItem } from "@/lib/gifts/types";
import { MediaRecorderPanel } from "./media-recorder-panel";

export type MessageType = "text" | "voice" | "video";
export type SendTiming = "now" | "scheduled";

// Recording durations match the Product Brief exactly: 60s voice, 30s video.
const MAX_VOICE_SECS = 60;
const MAX_VIDEO_SECS = 30;

export interface MessageDraft {
  recipientName: string;
  recipientPhone: string;
  messageType: MessageType;
  text: string;
  recordedMedia: RecordedMedia | null;
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

  const isRecordingMode = draft.messageType === "voice" || draft.messageType === "video";

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

      <div className="flex flex-col gap-8 pb-44">
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
          <div className="flex gap-2">
            <TabButton
              label="Text"
              active={draft.messageType === "text"}
              onClick={() => set("messageType", "text")}
            />
            <TabButton
              label="Voice"
              active={draft.messageType === "voice"}
              onClick={() => set("messageType", "voice")}
            />
            <TabButton
              label="Video"
              active={draft.messageType === "video"}
              onClick={() => set("messageType", "video")}
            />
          </div>

          {draft.messageType === "text" && (
            <>
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
            </>
          )}

          {draft.messageType === "voice" && (
            <MediaRecorderPanel
              kind="audio"
              maxDurationSecs={MAX_VOICE_SECS}
              initial={draft.recordedMedia}
              onRecorded={(media) => set("recordedMedia", media)}
              onCleared={() => set("recordedMedia", null)}
            />
          )}

          {draft.messageType === "video" && (
            <MediaRecorderPanel
              kind="video"
              maxDurationSecs={MAX_VIDEO_SECS}
              initial={draft.recordedMedia}
              onRecorded={(media) => set("recordedMedia", media)}
              onCleared={() => set("recordedMedia", null)}
            />
          )}
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-[11px] tracking-wide uppercase" style={{ color: "var(--gold-dim)" }}>
            When should it land
          </h2>
          <div className="flex gap-2">
            <TabButton
              label="Send now"
              active={draft.sendTiming === "now"}
              onClick={() => set("sendTiming", "now")}
            />
            <TabButton
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
            {!canContinue
              ? "Fill in the recipient's name and a valid WhatsApp number to continue."
              : isRecordingMode
                ? "Recording works — but sending a voice or video message needs a Cloudflare R2 upload step that isn't built yet. Text is the only type the backend can accept today."
                : "Review and payment aren't built yet — this is as far as it goes for now."}
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

function TabButton({
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
