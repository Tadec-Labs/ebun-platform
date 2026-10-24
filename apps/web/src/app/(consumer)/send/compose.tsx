"use client";

import { useEffect, useState } from "react";
import { FulfillmentType } from "@ebun/types";
import { API_BASE_URL } from "@/lib/api-config";
import type { RecordedMedia } from "@/lib/media-recording/use-media-recorder";
import type { GiftCatalogItem } from "@/lib/gifts/types";
import {
  OCCASIONS,
  type OccasionId,
  messagePlaceholder,
} from "@/lib/occasions";
import { formatNaira } from "@/lib/format-money";
import { MediaRecorderPanel } from "./media-recorder-panel";
import { RevealPreview } from "./reveal-preview";

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
  /**
   * Doorstep gifts, optional: the sender already knows where to bring it,
   * so the recipient never sees the address screen. Off by default — the
   * default is still "no address needed from you".
   */
  knowsAddress: boolean;
  deliveryAddress: string;
  deliveryArea: string;
  deliveryNote: string;
}

// Mirrors apps/api/src/orders/dto's PHONE_PATTERN exactly — keep these
// in sync. Client-side validation here is for immediate feedback only;
// the backend re-validates regardless and is the actual authority.
const PHONE_PATTERN = /^\+[1-9]\d{6,14}$/;
const MESSAGE_MAX_LENGTH = 2000;

/**
 * Who it's for and what you want to say — one screen, because that is
 * one thought. Splitting the recipient onto its own step made the flow
 * four gates long for a product competing with a bank transfer.
 *
 * The occasion lives here now rather than as the flow's first screen.
 * It was a full gate that collected nothing: CreateOrderDto has no
 * occasion field, so the only thing it ever did was choose a
 * placeholder and print a row on the review summary. Demoted to what it
 * actually is — a prompt for someone staring at an empty message box.
 */
export function Compose({
  gift,
  draft,
  occasion,
  onChangeDraft,
  onChangeOccasion,
  onChangeGift,
  allowScheduling,
  allowRecordings,
  onContinue,
}: {
  gift: GiftCatalogItem;
  draft: MessageDraft;
  occasion: OccasionId | null;
  onChangeDraft: (draft: MessageDraft) => void;
  onChangeOccasion: (occasion: OccasionId | null) => void;
  onChangeGift: () => void;
  allowScheduling: boolean;
  allowRecordings: boolean;
  onContinue: () => void;
}) {
  const [touchedPhone, setTouchedPhone] = useState(false);
  const phoneIsValid = PHONE_PATTERN.test(draft.recipientPhone.trim());
  const isDoorstep = gift.deliveryType === FulfillmentType.Physical;
  const addressOk =
    !isDoorstep ||
    !draft.knowsAddress ||
    (draft.deliveryAddress.trim().length >= 8 && draft.deliveryArea.trim().length >= 2);
  const canContinue = draft.recipientName.trim().length > 0 && phoneIsValid && addressOk;

  // The shop's delivery areas, so the sender taps one instead of typing.
  const [areas, setAreas] = useState<string[]>([]);
  useEffect(() => {
    if (!isDoorstep) return;
    let cancelled = false;
    fetch(`${API_BASE_URL}/gifts/${encodeURIComponent(gift.id)}/delivery-areas`)
      .then((res) => (res.ok ? (res.json() as Promise<{ areas: string[] }>) : { areas: [] }))
      .then((body) => {
        if (!cancelled) setAreas(Array.isArray(body.areas) ? body.areas : []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [gift.id, isDoorstep]);

  function set<K extends keyof MessageDraft>(key: K, value: MessageDraft[K]) {
    onChangeDraft({ ...draft, [key]: value });
  }

  const isRecordingMode =
    draft.messageType === "voice" || draft.messageType === "video";
  // A voice/video message needs its recording before payment: the file
  // travels with the order (see lib/orders/create-order.ts). If the tabs
  // are switched off mid-draft, recording mode can't be reached anyway.
  const readyForPayment =
    canContinue && (!isRecordingMode || (allowRecordings && draft.recordedMedia !== null));

  return (
    <>
      {/*
        Step 3 has had a labelled "← Back to your message" since it was
        built; step 2 only had the gift card below, whose "Change" reads
        as part of a summary rather than as navigation — the flow
        appeared to be one-way from here. Same control, same position,
        same wording pattern as step 3, so going back means the same
        thing on every step.

        Note this does NOT make the browser's own back button work:
        /send is one route holding its step in local state, so back
        still leaves the flow entirely. Fixing that means driving the
        step from the URL, which is a larger change than this one.
      */}
      <button
        type="button"
        onClick={onChangeGift}
        className="mb-5 self-start text-xs tracking-wide transition-colors hover:text-[color:var(--cream)]"
        style={{ color: "var(--cream-dim)" }}
      >
        ← Back to gifts
      </button>

      <button
        type="button"
        onClick={onChangeGift}
        className="mb-5 flex w-full items-center gap-3 border p-3 text-left transition-colors hover:border-[color:var(--border-strong)]"
        style={{ borderColor: "var(--border)", background: "var(--panel)" }}
      >
        <span className="min-w-0 flex-1">
          <span
            className="block truncate text-sm"
            style={{ color: "var(--cream)" }}
          >
            {gift.name}
          </span>
          <span
            className="block text-xs"
            style={{ color: "var(--gold-light)" }}
          >
            {formatNaira(gift.basePrice)}
          </span>
        </span>
        <span
          className="shrink-0 text-xs underline underline-offset-2"
          style={{ color: "var(--cream-dim)" }}
        >
          Change gift
        </span>
      </button>

      <div className="pb-7">
        <h1
          className="font-display text-3xl leading-tight font-normal"
          style={{ color: "var(--cream)" }}
        >
          Who&rsquo;s it for?
        </h1>
      </div>

      <div className="flex flex-col gap-8 pb-44">
        <section className="flex flex-col gap-4">
          <Field label="Their name">
            <input
              value={draft.recipientName}
              onChange={(e) => set("recipientName", e.target.value)}
              maxLength={200}
              placeholder="Ada"
              autoComplete="off"
              className="w-full border-0 border-b bg-transparent py-2 text-sm outline-none"
              style={{
                borderColor: "var(--border-strong)",
                color: "var(--cream)",
              }}
            />
          </Field>
          <Field
            label="Their WhatsApp number"
            error={
              touchedPhone &&
              draft.recipientPhone.trim().length > 0 &&
              !phoneIsValid
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
              autoComplete="tel"
              className="w-full border-0 border-b bg-transparent py-2 text-sm outline-none"
              style={{
                borderColor: "var(--border-strong)",
                color: "var(--cream)",
              }}
            />
          </Field>
        </section>

        {isDoorstep && (
          <section className="flex flex-col gap-4">
            {!draft.knowsAddress ? (
              <button
                type="button"
                onClick={() => set("knowsAddress", true)}
                className="self-start text-left text-xs leading-relaxed"
                style={{ color: "var(--cream-dim)" }}
              >
                No address needed — they&rsquo;ll add it when they open the gift.{" "}
                <span className="underline underline-offset-2" style={{ color: "var(--gold-light)" }}>
                  I know their address
                </span>
              </button>
            ) : (
              <>
                <Field label="Their address">
                  <textarea
                    value={draft.deliveryAddress}
                    onChange={(e) => set("deliveryAddress", e.target.value)}
                    rows={2}
                    maxLength={300}
                    placeholder="House number, street, estate"
                    className="w-full resize-none border-0 border-b bg-transparent py-2 text-sm outline-none"
                    style={{ borderColor: "var(--border-strong)", color: "var(--cream)" }}
                  />
                </Field>
                <Field label="Area">
                  {areas.length > 0 ? (
                    <select
                      value={draft.deliveryArea}
                      onChange={(e) => set("deliveryArea", e.target.value)}
                      className="w-full appearance-none border-0 border-b bg-transparent py-2 text-sm outline-none"
                      style={{
                        borderColor: "var(--border-strong)",
                        color: draft.deliveryArea ? "var(--cream)" : "var(--cream-faint)",
                      }}
                    >
                      <option value="">Choose their area</option>
                      {areas.map((a) => (
                        <option key={a} value={a} style={{ color: "#111" }}>
                          {a}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={draft.deliveryArea}
                      onChange={(e) => set("deliveryArea", e.target.value)}
                      maxLength={80}
                      placeholder="e.g. Alagbaka, GRA"
                      className="w-full border-0 border-b bg-transparent py-2 text-sm outline-none"
                      style={{ borderColor: "var(--border-strong)", color: "var(--cream)" }}
                    />
                  )}
                </Field>
                <Field label="Landmark (optional)">
                  <input
                    value={draft.deliveryNote}
                    onChange={(e) => set("deliveryNote", e.target.value)}
                    maxLength={300}
                    placeholder="Blue gate, opposite the filling station"
                    className="w-full border-0 border-b bg-transparent py-2 text-sm outline-none"
                    style={{ borderColor: "var(--border-strong)", color: "var(--cream)" }}
                  />
                </Field>
                <button
                  type="button"
                  onClick={() =>
                    onChangeDraft({ ...draft, knowsAddress: false, deliveryAddress: "", deliveryArea: "", deliveryNote: "" })
                  }
                  className="self-start text-xs underline underline-offset-2"
                  style={{ color: "var(--cream-dim)" }}
                >
                  Let them add it instead
                </button>
              </>
            )}
          </section>
        )}

        {/*
          Sits above the message box, not below it. Buried under the
          composer it was the last thing on the screen and the first
          thing hidden by the sticky pay bar — the one element whose
          entire job is to be seen before the sender decides the effort
          is worth it. Up here it personalises the moment a name is
          typed, which is the earliest point Ebun can show what it is.
        */}
        <RevealPreview
          gift={gift}
          recipientName={draft.recipientName}
          message={draft.messageType === "text" ? draft.text : ""}
        />

        <section className="flex flex-col gap-4">
          <div className="flex gap-2">
            <Tab
              label="Write"
              active={draft.messageType === "text"}
              onClick={() => set("messageType", "text")}
            />
            {allowRecordings && (
              <>
                <Tab
                  label="Voice"
                  active={draft.messageType === "voice"}
                  onClick={() => onChangeDraft({ ...draft, messageType: "voice", recordedMedia: null })}
                />
                <Tab
                  label="Video"
                  active={draft.messageType === "video"}
                  onClick={() => onChangeDraft({ ...draft, messageType: "video", recordedMedia: null })}
                />
              </>
            )}
          </div>

          {draft.messageType === "text" && (
            <>
              <p className="text-xs" style={{ color: "var(--cream-faint)" }}>
                Stuck? Pick a prompt.
              </p>
              <div
                className="flex flex-wrap gap-1.5"
                aria-label="Message starting points"
              >
                {OCCASIONS.map((item) => {
                  const active = occasion === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => onChangeOccasion(active ? null : item.id)}
                      className="border px-2.5 py-1.5 text-[11px] transition-colors"
                      style={{
                        borderColor: active ? "var(--gold)" : "var(--border)",
                        background: active ? "var(--gold-glow)" : "transparent",
                        color: active
                          ? "var(--gold-light)"
                          : "var(--cream-faint)",
                      }}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
              <textarea
                value={draft.text}
                onChange={(e) =>
                  set("text", e.target.value.slice(0, MESSAGE_MAX_LENGTH))
                }
                rows={5}
                placeholder={messagePlaceholder(occasion, draft.recipientName)}
                className="w-full resize-none border bg-transparent p-4 text-sm outline-none"
                style={{ borderColor: "var(--border)", color: "var(--cream)" }}
              />
              {draft.text.length > MESSAGE_MAX_LENGTH - 200 && (
                <p
                  className="text-right text-[10px]"
                  style={{ color: "var(--cream-faint)" }}
                >
                  {draft.text.length}/{MESSAGE_MAX_LENGTH}
                </p>
              )}
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

        {/*
          Hidden, not disabled, while the sender delivers the link
          themselves: a scheduled gift needs something on Ebun's side to
          send it at the chosen time, and with automatic WhatsApp
          delivery off there is nothing. A greyed-out option would only
          raise the question of why. sendTiming stays "now" either way.
        */}
        {allowScheduling && (
        <section className="flex flex-col gap-3">
          <div className="flex gap-2">
            <Tab
              label="Send now"
              active={draft.sendTiming === "now"}
              onClick={() => set("sendTiming", "now")}
            />
            <Tab
              label="Send later"
              active={draft.sendTiming === "scheduled"}
              onClick={() => set("sendTiming", "scheduled")}
            />
          </div>
          {draft.sendTiming === "scheduled" && (
            <>
              <input
                type="datetime-local"
                value={draft.scheduledFor}
                onChange={(e) => set("scheduledFor", e.target.value)}
                className="w-full border bg-transparent p-3 text-sm outline-none"
                style={{
                  borderColor: "var(--border-strong)",
                  color: "var(--cream)",
                  colorScheme: "dark",
                }}
              />
              <p
                className="text-[11px] leading-relaxed"
                style={{ color: "var(--cream-faint)" }}
              >
                Nothing reaches them before then — not even the link.
              </p>
            </>
          )}
        </section>
        )}
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
          <button
            type="button"
            onClick={onContinue}
            disabled={!readyForPayment}
            className="w-full py-3.5 text-sm font-medium tracking-wide disabled:opacity-40"
            style={{ background: "var(--action)", color: "var(--ink)" }}
          >
            Continue to payment
          </button>
          {!readyForPayment && (
            <p
              className="mt-2 text-center text-[11px] leading-relaxed"
              style={{ color: "var(--cream-faint)" }}
            >
              {!canContinue
                ? "Add their name and WhatsApp number to continue."
                : "Voice and video recording works, but sending one needs media storage that isn't live yet. Switch to Write to continue."}
            </p>
          )}
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

function Tab({
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
