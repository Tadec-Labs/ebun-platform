"use client";

import Link from "next/link";
import { formatNaira } from "@/lib/format-money";
import type { GiftCatalogItem } from "@/lib/gifts/types";
import { GOLD, GREEN, INK_TEXT, IVORY, IVORY_RAISED, LABEL_GOLD, LINE, MUTED_TEXT, SMALL_CAPS } from "./adire";
import { describeCollection, GiftArt, makerLabel } from "./gift-picker";

/*
 * The decision half of the gift step. Laptops get it as a panel beside
 * the grid; phones get the same pieces as a teaser card above the grid
 * and a bar along the bottom once a gift is picked.
 *
 * Nothing selected: show what the recipient will see (the reveal), the
 * one thing a bank transfer can't do. Something selected: the full
 * price, broken down, and the refund promise, right before Continue.
 */

const SOFT = "#EFE7D4";

/** The three steps, in the order they really happen. */
const STEPS = [
  "You pick a gift and add a message: written, voice or video",
  "You send them a private link on WhatsApp",
  "They scratch to reveal it, then hear from you",
] as const;

/**
 * A small picture of the recipient's reveal screen, drawn to match the
 * real one (/reveal/[token]): dark green, "someone's thinking of you",
 * a gold card to scratch, then the message. Decorative: the steps
 * beside it say the same thing in words.
 */
function RevealMock({ compact = false }: { compact?: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={`flex shrink-0 flex-col items-center justify-center text-center ${
        compact
          ? "h-[168px] w-[94px] gap-2 rounded-[18px] border-[4px] p-2"
          : "h-[400px] w-[220px] gap-4 rounded-[32px] border-[7px] p-5 [@media(max-height:860px)]:h-[320px] [@media(max-height:860px)]:w-[190px] [@media(max-height:860px)]:gap-3"
      }`}
      style={{ background: "#091C17", borderColor: INK_TEXT, color: "#F5F1E7" }}
    >
      <svg
        width={compact ? 16 : 30}
        height={compact ? 16 : 30}
        viewBox="0 0 24 24"
        fill="none"
        stroke={GOLD}
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 6h16v12H4z" />
        <path d="M4 7l8 6 8-6" />
      </svg>
      <p className={`font-display leading-tight ${compact ? "text-[11px]" : "text-[24px]"}`}>
        Tolu, someone&rsquo;s
        <br />
        thinking of you.
      </p>
      <div
        className={`flex w-full flex-col items-center justify-center font-semibold ${
          compact ? "h-[44px] gap-0.5 rounded-lg text-[7px]" : "h-[104px] gap-1.5 rounded-2xl text-[13px]"
        }`}
        style={{ background: GOLD, color: INK_TEXT }}
      >
        <svg width={compact ? 12 : 24} height={compact ? 12 : 24} viewBox="0 0 24 24" fill="none" stroke={INK_TEXT} strokeWidth="2" strokeLinecap="round">
          <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />
        </svg>
        Scratch to reveal
      </div>
      <span
        className={`flex items-center gap-1 rounded-full font-medium ${compact ? "px-1.5 py-0.5 text-[6.5px]" : "px-3 py-1.5 text-[12px]"}`}
        style={{ background: "#F5F1E7", color: GREEN }}
      >
        <svg width={compact ? 7 : 12} height={compact ? 7 : 12} viewBox="0 0 24 24" fill={GREEN}>
          <path d="M8 5v14l11-7z" />
        </svg>
        A message from you
      </span>
    </div>
  );
}

function Steps({ size = "text-sm" }: { size?: string }) {
  return (
    <ol className={`flex flex-col gap-3 ${size}`} style={{ color: INK_TEXT }}>
      {STEPS.map((step, i) => (
        <li key={step} className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold"
            style={{ background: GREEN, color: IVORY }}
          >
            {i + 1}
          </span>
          <span className="pt-0.5 leading-snug">{step}</span>
        </li>
      ))}
    </ol>
  );
}

/** What the refund policy actually promises, in a line, with the policy one tap away. */
function RefundLine() {
  return (
    <p className="flex items-start gap-2 text-[13px] leading-snug" style={{ color: MUTED_TEXT }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
        <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
      <span>
        Full refund if the shop can&rsquo;t honour it.{" "}
        <Link href="/refunds" className="underline underline-offset-4" style={{ color: GREEN }}>
          Refund policy
        </Link>
      </span>
    </p>
  );
}

/** The laptop panel before anything is picked. */
export function RevealPreview() {
  return (
    <div className="flex flex-col items-center gap-6 rounded-[24px] p-7 [@media(max-height:860px)]:gap-4 [@media(max-height:860px)]:p-5" style={{ background: SOFT }}>
      <p className={SMALL_CAPS} style={{ color: LABEL_GOLD }}>
        What they&rsquo;ll see
      </p>
      <RevealMock />
      <Steps />
      <p className="text-center text-[13px]" style={{ color: MUTED_TEXT }}>
        Pick a gift to see exactly what you&rsquo;ll pay.
      </p>
    </div>
  );
}

/** The phone version of the same idea, above the grid. Steps fold away. */
export function RevealTeaser() {
  return (
    <div className="flex items-center gap-4 rounded-[20px] p-3.5" style={{ background: SOFT }}>
      <RevealMock compact />
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="text-[11px] tracking-[0.14em] uppercase" style={{ color: LABEL_GOLD }}>
          The best part
        </p>
        <p className="font-display text-[21px] leading-tight" style={{ color: INK_TEXT }}>
          They scratch to reveal it, then hear from you.
        </p>
        <details className="group text-[13px]">
          <summary className="cursor-pointer list-none font-semibold underline underline-offset-4" style={{ color: GREEN }}>
            How it works
          </summary>
          <div className="pt-3">
            <Steps size="text-[13px]" />
          </div>
        </details>
      </div>
    </div>
  );
}

function PriceLines({ item }: { item: GiftCatalogItem }) {
  const rows: [string, number][] = [["Gift", item.basePrice]];
  if (item.deliveryFee > 0) rows.push(["Delivery", item.deliveryFee]);
  if (item.serviceFee > 0) rows.push(["Service fee", item.serviceFee]); // the Terms' and checkout's name for it
  return (
    <dl className="flex flex-col text-[14px]" style={{ color: INK_TEXT }}>
      {rows.map(([label, kobo]) => (
        <div key={label} className="flex justify-between py-1.5">
          <dt style={{ color: MUTED_TEXT }}>{label}</dt>
          <dd>{formatNaira(kobo)}</dd>
        </div>
      ))}
      <div className="mt-1 flex justify-between border-t pt-2.5 text-[16px] font-bold" style={{ borderColor: LINE }}>
        <dt>You pay</dt>
        {/* The API's total is exactly what Paystack charges; never re-add it here. */}
        <dd>{formatNaira(item.totalPrice)}</dd>
      </div>
    </dl>
  );
}

/** The laptop panel once a gift is picked. */
export function GiftDetails({
  item,
  city,
  cityName,
  onContinue,
}: {
  item: GiftCatalogItem;
  city: string | null;
  cityName: string | null;
  onContinue: () => void;
}) {
  return (
    // Must fit, Continue included, on a 1366×768 laptop without scrolling:
    // on short screens the picture is shallower and the description hides.
    <div className="flex flex-col gap-3 rounded-[24px] border p-6 [@media(max-height:860px)]:gap-2 [@media(max-height:860px)]:p-5" style={{ background: IVORY_RAISED, borderColor: LINE }}>
      <GiftArt item={item} className="aspect-[16/10] w-full rounded-2xl [@media(max-height:860px)]:aspect-[5/2]" large />
      <p className={`${SMALL_CAPS} pt-1`} style={{ color: LABEL_GOLD }}>
        {makerLabel(item, city)}
        {cityName && !item.nationwide ? ` · ${cityName}` : ""}
      </p>
      <h2 className="font-display text-[32px] leading-none" style={{ color: INK_TEXT }}>
        {item.name}
      </h2>
      <p className="text-[13px] leading-snug" style={{ color: MUTED_TEXT }}>
        {describeCollection(item, city)}
      </p>
      {item.description && (
        <p className="line-clamp-3 text-[14px] leading-relaxed [@media(max-height:860px)]:hidden" style={{ color: INK_TEXT }}>
          {item.description}
        </p>
      )}
      <div className="pt-1">
        <PriceLines item={item} />
      </div>
      <button
        type="button"
        onClick={onContinue}
        className="mt-1 min-h-12 w-full rounded-full text-[15px] font-semibold"
        style={{ background: GREEN, color: IVORY }}
      >
        Next: add your message
      </button>
      <RefundLine />
    </div>
  );
}

/**
 * Phones: once a gift is picked, a bar along the bottom with the all-in
 * price and Continue, so the decision never scrolls away. The breakdown
 * folds out of it. Announced politely to screen readers on change.
 */
export function SelectionBar({
  item,
  onContinue,
}: {
  item: GiftCatalogItem | null;
  onContinue: () => void;
}) {
  return (
    <div aria-live="polite" className="lg:hidden">
      {item && (
        <div
          className="fixed inset-x-0 bottom-0 z-30 border-t px-4 pt-3"
          style={{
            background: IVORY_RAISED,
            borderColor: LINE,
            borderRadius: "22px 22px 0 0",
            boxShadow: "0 -8px 24px rgba(14,42,33,0.10)",
            paddingBottom: "calc(0.875rem + env(safe-area-inset-bottom, 0px))",
            color: INK_TEXT,
          }}
        >
          <div className="mx-auto flex max-w-[640px] flex-col gap-2">
            <div className="flex items-center gap-3">
              <GiftArt item={item} className="size-12 shrink-0 rounded-xl" />
              <div className="flex min-w-0 grow flex-col">
                <span className="truncate text-[15px] font-semibold">{item.name}</span>
                <span className="text-[12.5px]" style={{ color: MUTED_TEXT }}>
                  {formatNaira(item.totalPrice)} all-in
                </span>
              </div>
              <button
                type="button"
                onClick={onContinue}
                className="min-h-11 shrink-0 rounded-full px-5 text-sm font-semibold"
                style={{ background: GREEN, color: IVORY }}
              >
                Continue
              </button>
            </div>
            <details className="text-[13px]">
              <summary className="cursor-pointer list-none py-1 font-medium" style={{ color: GREEN }}>
                What&rsquo;s included
              </summary>
              <div className="flex flex-col gap-2 pb-1">
                <PriceLines item={item} />
                <RefundLine />
              </div>
            </details>
          </div>
        </div>
      )}
    </div>
  );
}

