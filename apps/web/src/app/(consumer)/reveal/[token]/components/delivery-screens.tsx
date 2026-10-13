"use client";

import { useState, useTransition } from "react";
import { LockGlyph } from "@/components/icons";
import type { DeliveryDetails, RevealPayload } from "@/lib/reveal/types";
import { setDeliveryAction } from "../actions";
import { StatusLine } from "./status-line";

const field =
  "w-full border-0 border-b bg-transparent py-2.5 text-sm outline-none placeholder:text-[color:var(--cream-faint)]";

/**
 * "Where should this go?" — the one thing a doorstep gift needs from the
 * recipient. Four fields, two required: the address as they'd tell a
 * rider, and the area on its own (it picks the vendor nearest them and
 * is how Lagos riders actually navigate). Phone and landmark are
 * optional because the link already went to their number.
 */
export function AddressScreen({
  token,
  giftName,
  current,
  onSaved,
  onCancel,
}: {
  token: string;
  giftName?: string;
  /** Present when changing an address already given. */
  current: DeliveryDetails | null;
  onSaved: (payload: RevealPayload) => void;
  onCancel?: () => void;
}) {
  const [address, setAddress] = useState(current?.address ?? "");
  const [area, setArea] = useState(current?.area ?? "");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState(current?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const ready = address.trim().length >= 8 && area.trim().length >= 2;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setError(null);
    startTransition(async () => {
      const result = await setDeliveryAction(token, { address, area, phone, note });
      if (result.ok) onSaved(result.payload);
      else setError(result.message);
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-1 flex-col justify-center gap-7 py-6">
      <div className="flex flex-col gap-2 text-center">
        <h2 className="font-display text-3xl font-normal" style={{ color: "var(--cream)" }}>
          {current ? "Change the address" : "Where should this go?"}
        </h2>
        <p className="text-sm" style={{ color: "var(--cream-dim)" }}>
          {giftName ? `We'll bring ${giftName} to your door.` : "We'll bring it to your door."}
        </p>
      </div>

      <div className="flex flex-col gap-5">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] tracking-[0.12em] uppercase" style={{ color: "var(--gold-dim)" }}>
            Address
          </span>
          <textarea
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="House number, street, estate"
            rows={2}
            maxLength={300}
            required
            className={`${field} resize-none`}
            style={{ borderColor: "var(--border-strong)", color: "var(--cream)" }}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] tracking-[0.12em] uppercase" style={{ color: "var(--gold-dim)" }}>
            Area
          </span>
          <input
            value={area}
            onChange={(e) => setArea(e.target.value)}
            placeholder="e.g. Lekki Phase 1, Wuse 2, GRA"
            maxLength={80}
            required
            className={field}
            style={{ borderColor: "var(--border-strong)", color: "var(--cream)" }}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] tracking-[0.12em] uppercase" style={{ color: "var(--gold-dim)" }}>
            Landmark or note <span style={{ color: "var(--cream-faint)" }}>(optional)</span>
          </span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Opposite the filling station, blue gate"
            maxLength={300}
            className={field}
            style={{ borderColor: "var(--border-strong)", color: "var(--cream)" }}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] tracking-[0.12em] uppercase" style={{ color: "var(--gold-dim)" }}>
            Phone for the rider <span style={{ color: "var(--cream-faint)" }}>(optional)</span>
          </span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            autoComplete="tel"
            placeholder="Leave blank to use this WhatsApp number"
            maxLength={20}
            className={field}
            style={{ borderColor: "var(--border-strong)", color: "var(--cream)" }}
          />
        </label>
      </div>

      {error && (
        <p role="alert" className="text-xs" style={{ color: "var(--error)" }}>
          {error}
        </p>
      )}

      <div className="flex flex-col gap-3">
        <button
          type="submit"
          disabled={!ready || pending}
          className="w-full py-3.5 text-sm font-medium tracking-wide disabled:opacity-40"
          style={{ background: "var(--action)", color: "var(--ink)" }}
        >
          {pending ? "Saving…" : current ? "Save new address" : "Bring it here"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="text-xs" style={{ color: "var(--cream-dim)" }}>
            Keep the old address
          </button>
        )}
      </div>
    </form>
  );
}

/**
 * Between the address and the doorbell. Says honestly where it is —
 * being prepared, or with a rider (and who, with a number to call) —
 * and keeps the sender's message visibly waiting.
 */
export function TransitScreen({
  giftName,
  senderName,
  delivery,
  messageLocked,
  onChangeAddress,
}: {
  giftName?: string;
  senderName?: string | null;
  delivery: DeliveryDetails | null;
  messageLocked: boolean;
  onChangeAddress: () => void;
}) {
  const onTheWay = delivery?.stage === "on_the_way";
  const sender = senderName ? `${senderName}'s` : "Their";

  return (
    <div className="flex flex-1 flex-col justify-center gap-9 py-6">
      <div className="flex flex-col gap-2 text-center">
        <h2 className="font-display text-3xl font-normal" style={{ color: "var(--cream)" }}>
          {onTheWay ? "It’s on its way." : "It’s being prepared."}
        </h2>
        <p className="text-sm" style={{ color: "var(--cream-dim)" }}>
          {giftName ?? "Your gift"}
          {!onTheWay && delivery?.placeName ? ` · by ${delivery.placeName}` : ""}
        </p>
        {!onTheWay && delivery?.window && (
          <p className="text-xs" style={{ color: "var(--gold-light)" }}>
            {delivery.window}
          </p>
        )}
      </div>

      <StatusLine
        steps={[
          { label: "Address in", state: "done" },
          { label: "Preparing", state: onTheWay ? "done" : "current" },
          { label: "On its way", state: onTheWay ? "current" : "upcoming" },
          { label: "At your door", state: "upcoming" },
        ]}
      />

      {onTheWay && (delivery?.riderName || delivery?.riderPhone) && (
        <div
          className="flex items-center justify-between gap-3 border px-4 py-3"
          style={{ borderColor: "var(--border)", background: "var(--panel-raised)" }}
        >
          <p className="text-sm" style={{ color: "var(--cream)" }}>
            {delivery.riderName ? `${delivery.riderName} is bringing it` : "Your rider"}
          </p>
          {delivery.riderPhone && (
            <a
              href={`tel:${delivery.riderPhone.replace(/[^+0-9]/g, "")}`}
              className="shrink-0 border-b pb-0.5 text-xs"
              style={{ borderColor: "var(--gold-dim)", color: "var(--gold-light)" }}
            >
              Call
            </a>
          )}
        </div>
      )}

      {delivery?.address && (
        <div className="flex flex-col gap-1 border-l-2 pl-4" style={{ borderColor: "var(--gold-dim)" }}>
          <p className="text-[10px] tracking-[0.16em] uppercase" style={{ color: "var(--gold-dim)" }}>
            Delivering to
          </p>
          <p className="text-sm leading-relaxed" style={{ color: "var(--cream)" }}>
            {delivery.address}
            {delivery.area ? `, ${delivery.area}` : ""}
          </p>
          {delivery.note && (
            <p className="text-xs" style={{ color: "var(--cream-dim)" }}>
              {delivery.note}
            </p>
          )}
          {delivery.canChangeAddress && (
            <button
              type="button"
              onClick={onChangeAddress}
              className="mt-1 self-start border-b pb-0.5 text-xs"
              style={{ borderColor: "var(--gold-dim)", color: "var(--gold-light)" }}
            >
              Change address
            </button>
          )}
        </div>
      )}

      {messageLocked && (
        <div className="flex items-center gap-3 border px-4 py-3" style={{ borderColor: "var(--border)" }}>
          <LockGlyph className="h-4 w-4 flex-shrink-0 text-[color:var(--gold-dim)]" />
          <p className="text-xs leading-snug" style={{ color: "var(--cream-dim)" }}>
            {sender} message opens with it, the moment it arrives. Keep this page — it updates by itself.
          </p>
        </div>
      )}
    </div>
  );
}
