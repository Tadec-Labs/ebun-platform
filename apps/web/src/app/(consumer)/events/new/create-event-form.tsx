"use client";

import { useState } from "react";
import { BrandLogo } from "@/components/brand-logo";
import { PolicyLinks } from "@/components/policy-links";
import { EVENT_COPY, EVENT_TYPE_ORDER } from "@/lib/events/copy";
import { EventError, createEvent } from "@/lib/events/api";
import type { EventType } from "@/lib/events/types";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** "0803 123 4567" / "+234 803…" / "2348031234567" -> "+2348031234567", or null. */
function toE164(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, "");
  if (/^\+[1-9]\d{6,14}$/.test(digits)) return digits;
  if (/^0\d{10}$/.test(digits)) return `+234${digits.slice(1)}`;
  if (/^234\d{10}$/.test(digits)) return `+${digits}`;
  return null;
}

function todayIso(): string {
  const lagos = new Date(Date.now() + 3_600_000);
  return lagos.toISOString().slice(0, 10);
}

/**
 * E1 · The host sets up an event in one screen: what it is, whose it is,
 * when and where, and what guests can do. Nothing is paid here. The
 * private host link comes back and the host lands on their page.
 */
export function CreateEventForm() {
  const [eventType, setEventType] = useState<EventType>("wedding");
  const [title, setTitle] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [city, setCity] = useState("");
  const [hostName, setHostName] = useState("");
  const [hostEmail, setHostEmail] = useState("");
  const [hostPhone, setHostPhone] = useState("");
  const [giftList, setGiftList] = useState(true);
  const [cash, setCash] = useState(true);
  const [wall, setWall] = useState(true);
  const [showAmounts, setShowAmounts] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copy = EVENT_COPY[eventType];
  const remembrance = eventType === "remembrance";
  const phone = toE164(hostPhone);
  const emailOk = EMAIL_PATTERN.test(hostEmail.trim());
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(eventDate) && eventDate >= todayIso();
  const ready =
    title.trim() && dateOk && city.trim() && hostName.trim() && emailOk && phone && (giftList || cash) && !submitting;

  async function submit() {
    if (!ready || !phone) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await createEvent({
        eventType,
        title: title.trim(),
        eventDate,
        city: city.trim(),
        hostName: hostName.trim(),
        hostEmail: hostEmail.trim(),
        hostPhone: phone,
        giftListEnabled: giftList,
        cashEnabled: cash,
        wallEnabled: wall,
        showAmounts: remembrance ? false : showAmounts,
      });
      // The private link: the route behind it keeps the token in a
      // cookie and takes the host to their page.
      window.location.href = result.managePath;
    } catch (e) {
      setError(e instanceof EventError ? e.message : "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col px-7">
      <header className="flex items-center justify-between pt-5 pb-7">
        <BrandLogo size="sm" />
        <p className="text-[11px] tracking-wide" style={{ color: "var(--cream-dim)" }}>
          Events
        </p>
      </header>

      <h1 className="font-display pb-6 text-3xl leading-tight font-normal" style={{ color: "var(--cream)" }}>
        One link for <span style={{ color: "var(--gold-light)" }}>every gift.</span>
      </h1>

      <div className="flex flex-col gap-7 pb-44">
        <fieldset className="flex flex-col gap-3">
          <legend className="sr-only">Occasion</legend>
          <div className="flex flex-wrap gap-2">
            {EVENT_TYPE_ORDER.map((type) => {
              const active = type === eventType;
              return (
                <button
                  key={type}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setEventType(type)}
                  className="border px-3.5 py-2 text-xs transition-colors"
                  style={{
                    borderColor: active ? "var(--gold)" : "var(--border)",
                    background: active ? "var(--gold)" : "transparent",
                    color: active ? "var(--ink)" : "var(--cream-dim)",
                  }}
                >
                  {EVENT_COPY[type].label}
                </button>
              );
            })}
          </div>
        </fieldset>

        <section className="flex flex-col gap-4">
          <Field label={copy.titleLabel}>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              placeholder={copy.titlePlaceholder}
              className={underline}
              style={inputStyle}
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Date" error={eventDate && !dateOk ? "Pick a future date" : undefined}>
              <input
                type="date"
                value={eventDate}
                min={todayIso()}
                onChange={(e) => setEventDate(e.target.value)}
                className={underline}
                style={{ ...inputStyle, colorScheme: "dark" }}
              />
            </Field>
            <Field label="City">
              <input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                maxLength={80}
                placeholder="Akure"
                className={underline}
                style={inputStyle}
              />
            </Field>
          </div>
        </section>

        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">What guests can do</legend>
          <Toggle checked={giftList} onChange={setGiftList} title="Gift list" />
          <Toggle checked={cash} onChange={setCash} title={copy.cash} />
          <Toggle checked={wall} onChange={setWall} title={copy.wall} />
          {!remembrance && <Toggle checked={showAmounts} onChange={setShowAmounts} title="Show amounts" />}
        </fieldset>

        <section className="flex flex-col gap-4">
          <Field label="Your name">
            <input
              value={hostName}
              onChange={(e) => setHostName(e.target.value)}
              maxLength={120}
              autoComplete="name"
              className={underline}
              style={inputStyle}
            />
          </Field>
          <Field label="Email" error={hostEmail && !emailOk ? "Check the email" : undefined}>
            <input
              type="email"
              value={hostEmail}
              onChange={(e) => setHostEmail(e.target.value)}
              autoComplete="email"
              className={underline}
              style={inputStyle}
            />
          </Field>
          <Field label="WhatsApp number" error={hostPhone && !phone ? "Check the number" : undefined}>
            <input
              type="tel"
              value={hostPhone}
              onChange={(e) => setHostPhone(e.target.value)}
              autoComplete="tel"
              placeholder="0803 123 4567"
              className={underline}
              style={inputStyle}
            />
          </Field>
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
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!ready}
            className="w-full py-3.5 text-sm font-medium tracking-wide disabled:opacity-40"
            style={{ background: "var(--action)", color: "var(--ink)" }}
          >
            {submitting ? "Creating…" : "Create link"}
          </button>
        </div>
      </div>
      <PolicyLinks className="mt-auto pt-6 pb-8" />
    </div>
  );
}

const underline = "w-full border-0 border-b bg-transparent py-2 text-sm outline-none";
const inputStyle = { borderColor: "var(--border-strong)", color: "var(--cream)" } as const;

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

function Toggle({ checked, onChange, title }: { checked: boolean; onChange: (next: boolean) => void; title: string }) {
  return (
    <label
      className="flex min-h-12 cursor-pointer items-center justify-between gap-3 border px-3.5"
      style={{ borderColor: checked ? "var(--border-strong)" : "var(--border)", background: "var(--panel)" }}
    >
      <span className="text-sm" style={{ color: "var(--cream)" }}>
        {title}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-5 w-5 flex-shrink-0"
        style={{ accentColor: "var(--gold)" }}
      />
    </label>
  );
}
