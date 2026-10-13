"use client";

import { useState, useTransition } from "react";
import type { CollectionPoint, PickupBooking } from "@/lib/reveal/types";
import { whatsappChatUrl } from "@/lib/whatsapp-share";
import { bookPickupAction } from "../actions";

/**
 * "When are you coming?" — the step that lets a vendor have the gift
 * ready instead of starting a 30-minute pizza when the recipient walks in.
 *
 * Two halves. Booking records the time with SendEbun, which puts it on
 * the vendor's "Coming in" list. Then one tap opens WhatsApp with the
 * vendor's number and the message written, because a list on a phone
 * the vendor may not be looking at is not the same as their phone
 * buzzing. Until SendEbun can message vendors itself (Termii/Meta),
 * the recipient's own WhatsApp is the most reliable bell there is.
 *
 * Appointment gifts (a spa session, a shoot) use the same booking, worded
 * as a request: the time is a slot the vendor has to agree to, not a
 * heads-up, so there are no "in 30 min" shortcuts and the copy says
 * "requested" until the vendor confirms.
 *
 * Times are shown in Lagos time: the gift is collected in Nigeria, and a
 * recipient travelling abroad still needs the counter's clock.
 */
const QUICK_TIMES = [
  { label: "In 30 min", minutes: 30 },
  { label: "In 1 hour", minutes: 60 },
  { label: "In 2 hours", minutes: 120 },
] as const;

export function PickupBookingPanel({
  token,
  places,
  giftName,
  recipientName,
  appointment = false,
  booking,
  onBooked,
}: {
  token: string;
  places: CollectionPoint[];
  giftName?: string;
  recipientName?: string;
  appointment?: boolean;
  booking: PickupBooking | null;
  onBooked: (booking: PickupBooking) => void;
}) {
  const [editing, setEditing] = useState(booking === null);
  const [vendorId, setVendorId] = useState(booking?.vendorId ?? places[0]?.vendorId ?? "");
  const [quick, setQuick] = useState<number | null>(appointment ? null : 30);
  const [custom, setCustom] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (places.length === 0) return null;

  if (booking && !editing) {
    const place = places.find((p) => p.vendorId === booking.vendorId);
    const placeName = booking.placeName ?? place?.name ?? "the shop";
    const whatsapp = booking.whatsapp ?? place?.whatsapp ?? null;
    return (
      <section
        className="flex flex-col gap-3 border px-4 py-4"
        style={{ borderColor: "var(--gold-dim)", background: "var(--panel-raised)" }}
        aria-label={appointment ? "Your appointment" : "Your pickup"}
      >
        <p className="text-[10px] tracking-[0.16em] uppercase" style={{ color: "var(--gold-dim)" }}>
          {appointment ? (booking.confirmed ? "Your appointment" : "Appointment requested") : "Your pickup"}
        </p>
        <p className="font-display text-xl leading-snug" style={{ color: "var(--cream)" }}>
          {formatWhen(booking.at)} at {placeName}
        </p>
        <p className="text-xs" style={{ color: booking.confirmed ? "var(--gold-light)" : "var(--cream-dim)" }}>
          {appointment
            ? booking.confirmed
              ? `✓ ${placeName} confirmed your appointment.`
              : `Waiting for ${placeName} to confirm this time. Message them — if it's taken, they'll suggest another.`
            : booking.confirmed
              ? `✓ ${placeName} confirmed — it'll be ready.`
              : `Waiting for ${placeName} to confirm. Send them a message so they can start on it.`}
        </p>
        {whatsapp && (
          <a
            href={whatsappChatUrl(whatsapp, vendorMessage(placeName, recipientName, giftName, booking.at, appointment))}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full py-3 text-center text-sm font-medium tracking-wide"
            style={
              booking.confirmed
                ? { border: "1px solid var(--border-strong)", color: "var(--cream)" }
                : { background: "var(--action)", color: "var(--ink)" }
            }
          >
            {booking.confirmed ? `Message ${placeName}` : `Tell ${placeName} on WhatsApp`}
          </a>
        )}
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="self-start border-b pb-0.5 text-xs"
          style={{ borderColor: "var(--gold-dim)", color: "var(--gold-light)" }}
        >
          Change time
        </button>
      </section>
    );
  }

  function pickupAtIso(): string | null {
    if (quick !== null) return new Date(Date.now() + quick * 60_000).toISOString();
    if (!custom) return null;
    // datetime-local has no zone; it is the phone's local time, which is
    // what the person picking it meant.
    const at = new Date(custom);
    return Number.isNaN(at.getTime()) ? null : at.toISOString();
  }

  function submit() {
    const at = pickupAtIso();
    if (!vendorId || !at) {
      setError("Pick a time.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await bookPickupAction(token, vendorId, at);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      if (result.payload.pickup) {
        onBooked(result.payload.pickup);
        setEditing(false);
      }
    });
  }

  return (
    <section
      className="flex flex-col gap-4 border px-4 py-4"
      style={{ borderColor: "var(--gold-dim)", background: "var(--panel-raised)" }}
      aria-label={appointment ? "Book your appointment" : "Book your pickup"}
    >
      <div className="flex flex-col gap-1">
        <p className="font-display text-xl" style={{ color: "var(--cream)" }}>
          {appointment ? "Book your appointment" : "When are you collecting?"}
        </p>
        <p className="text-xs leading-relaxed" style={{ color: "var(--cream-dim)" }}>
          {appointment
            ? "Pick a time that suits you. They'll confirm it, or suggest another if it's taken."
            : "So it’s ready when you walk in, not started when you arrive."}
        </p>
      </div>

      {places.length > 1 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-xs" style={{ color: "var(--cream-dim)" }}>
            Where
          </legend>
          {places.map((place) => (
            <label key={place.vendorId} className="flex items-center gap-2.5 text-sm" style={{ color: "var(--cream)" }}>
              <input
                type="radio"
                name="pickup-place"
                checked={vendorId === place.vendorId}
                onChange={() => setVendorId(place.vendorId)}
              />
              {place.name}
            </label>
          ))}
        </fieldset>
      )}

      {!appointment && (
      <div className="flex flex-wrap gap-2" role="group" aria-label="When">
        {QUICK_TIMES.map((option) => (
          <button
            key={option.minutes}
            type="button"
            onClick={() => {
              setQuick(option.minutes);
              setCustom("");
            }}
            aria-pressed={quick === option.minutes}
            className="px-3 py-2 text-xs"
            style={
              quick === option.minutes
                ? { background: "var(--gold-light)", color: "var(--ink)" }
                : { border: "1px solid var(--border-strong)", color: "var(--cream)" }
            }
          >
            {option.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setQuick(null)}
          aria-pressed={quick === null}
          className="px-3 py-2 text-xs"
          style={
            quick === null
              ? { background: "var(--gold-light)", color: "var(--ink)" }
              : { border: "1px solid var(--border-strong)", color: "var(--cream)" }
          }
        >
          Later
        </button>
      </div>
      )}

      {quick === null && (
        <input
          type="datetime-local"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          aria-label={appointment ? "Appointment time" : "Pickup time"}
          className="w-full border-0 border-b bg-transparent py-2 text-sm outline-none"
          style={{ borderColor: "var(--border-strong)", color: "var(--cream)", colorScheme: "dark" }}
        />
      )}

      {error && (
        <p className="text-xs" style={{ color: "var(--error)" }}>
          {error}
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="flex-1 py-3 text-sm font-medium tracking-wide disabled:opacity-50"
          style={{ background: "var(--action)", color: "var(--ink)" }}
        >
          {pending ? "Booking…" : appointment ? "Request this time" : "Book pickup"}
        </button>
        {booking && (
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="px-4 text-xs"
            style={{ color: "var(--cream-dim)" }}
          >
            Cancel
          </button>
        )}
      </div>
    </section>
  );
}

function formatWhen(iso: string): string {
  const at = new Date(iso);
  const now = new Date();
  const fmtDay = (d: Date) => d.toLocaleDateString("en-NG", { timeZone: "Africa/Lagos" });
  const time = at.toLocaleTimeString("en-NG", {
    timeZone: "Africa/Lagos",
    hour: "numeric",
    minute: "2-digit",
  });
  if (fmtDay(at) === fmtDay(now)) return `Today, ${time}`;
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60_000);
  if (fmtDay(at) === fmtDay(tomorrow)) return `Tomorrow, ${time}`;
  const day = at.toLocaleDateString("en-NG", {
    timeZone: "Africa/Lagos",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  return `${day}, ${time}`;
}

/**
 * In the recipient's voice, from their own number. No collection code:
 * that is shown at the counter, not sent ahead, so a forwarded message
 * can't be used to collect the gift.
 */
function vendorMessage(
  placeName: string,
  recipientName: string | undefined,
  giftName: string | undefined,
  at: string,
  appointment = false,
): string {
  const firstName = recipientName?.trim().split(/\s+/)[0];
  const who = firstName ? `I'm ${firstName}. ` : "";
  const when = formatWhen(at).replace(/^Today, /, "today at ").replace(/^Tomorrow, /, "tomorrow at ");
  if (appointment) {
    return (
      `Hi ${placeName}, ${who}I have a SendEbun gift — ${giftName ?? "an appointment"} — ` +
      `and I'd like to come ${when}. Is that time free? It's on your SendEbun link under "Coming in". Thank you!`
    );
  }
  return (
    `Hi ${placeName}, ${who}I'm collecting a SendEbun gift — ${giftName ?? "my gift"} — ` +
    `${formatWhen(at).replace(/^Today, /, "today at ").replace(/^Tomorrow, /, "tomorrow at ")}. ` +
    `Please have it ready. It's on your SendEbun link under "Coming in". Thank you!`
  );
}
