"use client";

import { GiftMark } from "@/components/icons";
import type { GiftCatalogItem } from "@/lib/gifts/types";

/**
 * What the recipient will see, shown to the sender while they are still
 * deciding whether this is worth the effort.
 *
 * This is the single most important screen element in the sender flow.
 * Ebun asks for more work than the thing it replaces — a bank transfer
 * is a number, an amount and a tap — and the reason to accept that extra
 * work is an experience that happens to somebody else, later, out of
 * sight. Every version of this flow before this one charged the cost up
 * front and delivered the value where the sender could never see it.
 *
 * Deliberately NOT a phone mockup with a notch and a status bar. A
 * drawn device frame is decoration that competes with the thing it is
 * framing; this is a quiet card that borrows the reveal screen's own
 * display type and gold so it reads as a window onto that moment
 * rather than a picture of a phone.
 */
export function RevealPreview({
  gift,
  recipientName,
  message,
  senderName,
}: {
  gift: GiftCatalogItem;
  recipientName: string;
  message: string;
  senderName?: string;
}) {
  const name = recipientName.trim();
  const body = message.trim();
  const from = senderName?.trim();

  return (
    <figure className="m-0 flex flex-col gap-3">
      <figcaption className="text-xs" style={{ color: "var(--cream-dim)" }}>
        {name ? `What ${name} opens` : "What they open"}
      </figcaption>

      <div
        className="flex flex-col gap-5 border px-5 py-6"
        style={{
          borderColor: "var(--border-strong)",
          background: "var(--panel)",
        }}
      >
        <p
          className="font-display text-xl leading-snug"
          style={{ color: "var(--cream)" }}
        >
          {name ? `${name}, someone's` : "Someone's"}
          <br />
          thinking of you.
        </p>

        <div
          className="flex gap-4 border-t pt-5"
          style={{ borderColor: "var(--border)" }}
        >
          <div
            className="flex h-14 w-14 shrink-0 items-center justify-center border"
            style={{
              borderColor: "var(--border)",
              background: "var(--panel-raised)",
            }}
          >
            {gift.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- catalog images are remote URLs
              <img src={gift.imageUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <GiftMark className="h-6 w-6 text-[color:var(--gold-dim)]" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-display text-lg leading-tight" style={{ color: "var(--cream)" }}>
              {gift.name}
            </p>
            {body ? (
              <p
                className="mt-2 text-xs leading-relaxed"
                style={{ color: "var(--cream-dim)" }}
              >
                &ldquo;{body.length > 120 ? `${body.slice(0, 120)}…` : body}&rdquo;
              </p>
            ) : (
              // An empty state that tells the sender what is missing and
              // why it matters, rather than leaving a silent gap.
              <p
                className="mt-2 text-xs leading-relaxed"
                style={{ color: "var(--cream-faint)" }}
              >
                Your message appears here. This is the part they remember.
              </p>
            )}
            {from && (
              <p className="mt-3 text-[11px]" style={{ color: "var(--gold-dim)" }}>
                From {from}
              </p>
            )}
          </div>
        </div>
      </div>
    </figure>
  );
}
