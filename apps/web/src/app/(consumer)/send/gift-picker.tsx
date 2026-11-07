"use client";

import { useMemo, useRef, useState } from "react";
import {
  FulfillmentType,
  GIFT_CATEGORY_LABEL,
  OCCASIONS,
  OCCASION_LABEL,
  type Occasion,
} from "@ebun/types";
import { GiftMark } from "@/components/icons";
import { formatNaira } from "@/lib/format-money";
import type { GiftCatalogItem } from "@/lib/gifts/types";

type Category = GiftCatalogItem["category"];

const CATEGORY_LABEL: Record<Category, string> = GIFT_CATEGORY_LABEL;

const MOMENT_HEADING: Record<Occasion, string> = {
  birthday: "For their birthday",
  thank_you: "To say thank you",
  congratulations: "To say well done",
  love: "Because you love them",
  just_because: "Just because",
  get_well: "To help them feel better",
  new_baby: "For the new baby",
  festive: "For the season",
};

/** How many big cards the swipe row holds before the rest drop to the list below. */
const TOP_PICKS = 5;

/**
 * The entry point, and the hook: one screen, no gates.
 *
 * Big swipeable cards up top (the "best picks"), every other gift in a
 * compact grid underneath, and one optional row of moments. Choosing a
 * moment doesn't hide anything — it reorders, so the gifts ops tagged
 * for that moment come first. Nobody is boxed in by a missing reason:
 * "Anything" (the default) shows the catalogue as ops ordered it.
 *
 * Swipe on phones, arrows on laptops, one tap on a card to send it.
 * Prices stay small; the photo and the name do the selling.
 */
export function GiftPicker({
  catalog,
  catalogReachable,
  onChoose,
}: {
  catalog: GiftCatalogItem[];
  catalogReachable: boolean;
  onChoose: (gift: GiftCatalogItem, moment: Occasion | null) => void;
}) {
  const [moment, setMoment] = useState<Occasion | null>(null);

  // Only moments some gift is tagged for; fixed order from the shared list.
  const moments = useMemo(
    () => OCCASIONS.filter((o) => catalog.some((item) => item.occasions?.includes(o))),
    [catalog],
  );

  // Reorder, never filter: matches first, featured first within each group.
  const ordered = useMemo(() => {
    const score = (item: GiftCatalogItem) =>
      (moment && item.occasions?.includes(moment) ? 2 : 0) + (item.featured ? 1 : 0);
    return catalog
      .map((item, i) => ({ item, i }))
      .sort((a, b) => score(b.item) - score(a.item) || a.i - b.i)
      .map((x) => x.item);
  }, [catalog, moment]);

  const matches = moment ? ordered.filter((item) => item.occasions?.includes(moment)).length : ordered.length;
  const picks = ordered.slice(0, Math.max(1, Math.min(TOP_PICKS, matches)));
  const rest = ordered.slice(picks.length);
  const choose = (gift: GiftCatalogItem) => onChoose(gift, moment);

  return (
    <>
      <h1
        className="font-display pb-5 text-3xl leading-tight font-normal md:text-4xl"
        style={{ color: "var(--cream)" }}
      >
        {moment ? MOMENT_HEADING[moment] : "Make someone\u2019s day"}
      </h1>

      {moments.length > 0 && (
        <div
          className="-mx-7 mb-5 flex gap-2 overflow-x-auto px-7 pb-1 [scrollbar-width:none] md:mx-0 md:px-0"
          role="group"
          aria-label="What's the moment?"
        >
          <Chip active={moment === null} onClick={() => setMoment(null)}>
            Anything
          </Chip>
          {moments.map((item) => (
            <Chip key={item} active={moment === item} onClick={() => setMoment(moment === item ? null : item)}>
              {OCCASION_LABEL[item]}
            </Chip>
          ))}
        </div>
      )}

      {catalog.length === 0 ? (
        <div
          className="mb-12 border p-6 text-center text-sm leading-relaxed"
          style={{ borderColor: "var(--border)", color: "var(--cream-dim)" }}
        >
          {/* Two different problems, two different fixes: nothing on sale vs. a failed load. */}
          {catalogReachable
            ? "There's nothing to send just yet. We're adding gifts — check back shortly."
            : "The gift list didn't load. Check your connection and reload the page."}
        </div>
      ) : (
        <div className="flex flex-col gap-8 pb-14">
          {/* key: a new moment starts the row from its first card. */}
          <PickRow key={moment ?? "all"} picks={picks} onChoose={choose} />
          {rest.length > 0 && (
            <section aria-label="More gifts">
              <h2 className="mb-3 text-xs tracking-[0.16em] uppercase" style={{ color: "var(--gold-dim)" }}>
                More gifts
              </h2>
              <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4">
                {rest.map((item) => (
                  <li key={item.id} className="flex">
                    <GiftCard item={item} onChoose={() => choose(item)} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </>
  );
}

/**
 * The swipe row. Native scroll-snap, not a carousel library: it is
 * smooth on low-end Android, works with a trackpad, and needs no
 * dependency. A light vibration marks each new card where the phone
 * supports it; arrows appear on wider screens, where nobody swipes.
 */
function PickRow({
  picks,
  onChoose,
}: {
  picks: GiftCatalogItem[];
  onChoose: (gift: GiftCatalogItem) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);

  const onScroll = () => {
    const row = rowRef.current;
    if (!row) return;
    const card = row.firstElementChild as HTMLElement | null;
    if (!card) return;
    const next = Math.round(row.scrollLeft / (card.offsetWidth + 12));
    if (next !== index) {
      setIndex(next);
      if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(8);
    }
  };

  const go = (to: number) => {
    const row = rowRef.current;
    const card = row?.children[to] as HTMLElement | undefined;
    if (row && card) row.scrollTo({ left: card.offsetLeft - row.offsetLeft, behavior: "smooth" });
  };

  return (
    <div className="relative">
      <div
        ref={rowRef}
        onScroll={onScroll}
        className="-mx-7 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth px-7 [scrollbar-width:none] md:mx-0 md:px-0"
        aria-label="Best picks"
      >
        {picks.map((item) => (
          <PickCard key={item.id} item={item} onChoose={() => onChoose(item)} />
        ))}
      </div>

      {picks.length > 1 && (
        <div className="mt-4 flex items-center justify-center gap-4">
          <ArrowButton label="Previous gift" disabled={index === 0} onClick={() => go(index - 1)} dir="left" />
          <div className="flex gap-1.5" aria-hidden="true">
            {picks.map((item, i) => (
              <span
                key={item.id}
                className="h-1.5 rounded-full transition-all duration-300"
                style={{ width: i === index ? 18 : 6, background: i === index ? "var(--gold)" : "var(--border-strong)" }}
              />
            ))}
          </div>
          <ArrowButton label="Next gift" disabled={index >= picks.length - 1} onClick={() => go(index + 1)} dir="right" />
        </div>
      )}
    </div>
  );
}

function ArrowButton({
  label,
  disabled,
  onClick,
  dir,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  dir: "left" | "right";
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="hidden h-9 w-9 items-center justify-center rounded-full border transition-opacity disabled:opacity-30 md:flex"
      style={{ borderColor: "var(--border-strong)", color: "var(--cream)" }}
    >
      <span aria-hidden="true">{dir === "left" ? "\u2190" : "\u2192"}</span>
    </button>
  );
}

function PickCard({ item, onChoose }: { item: GiftCatalogItem; onChoose: () => void }) {
  return (
    <button
      type="button"
      onClick={onChoose}
      className="group flex w-[84%] shrink-0 snap-center flex-col overflow-hidden border text-left transition-transform duration-200 active:scale-[0.98] md:w-[46%]"
      style={{ borderColor: "var(--border-strong)", background: "var(--panel)" }}
    >
      <GiftArt item={item} className="aspect-[4/3] w-full md:aspect-[16/9]" large />
      <div className="flex flex-1 flex-col gap-1.5 p-5">
        <h2 className="font-display line-clamp-2 text-2xl leading-tight" style={{ color: "var(--cream)" }}>
          {item.name}
        </h2>
        <span className="text-xs" style={{ color: "var(--cream-faint)" }}>
          {describeCollection(item)}
        </span>
        <div className="mt-auto flex items-center justify-between pt-4">
          <span className="text-sm" style={{ color: "var(--gold-light)" }}>
            {formatNaira(item.basePrice)}
          </span>
          <span
            className="px-4 py-2 text-xs font-medium tracking-wide"
            style={{ background: "var(--gold)", color: "var(--ink)" }}
          >
            Send this
          </span>
        </div>
      </div>
    </button>
  );
}

function Chip({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="shrink-0 rounded-full border px-3.5 py-1.5 text-xs whitespace-nowrap transition-colors"
      style={{
        borderColor: active ? "var(--gold)" : "var(--border)",
        background: active ? "var(--gold)" : "transparent",
        color: active ? "var(--ink)" : "var(--cream-dim)",
      }}
    >
      {children}
    </button>
  );
}

/**
 * How the recipient actually gets it, in their words. Each fulfilment
 * type is genuinely different: a voucher is collected in person, a
 * top-up just arrives, a physical gift is delivered.
 */
function describeCollection(item: GiftCatalogItem): string {
  switch (item.deliveryType) {
    case FulfillmentType.Physical:
      return item.deliveryWindow
        ? `Delivered to their door · ${item.deliveryWindow}`
        : "Delivered to their door";
    case FulfillmentType.Vtu:
      return "Arrives on their line in seconds";
    default:
      return item.bookingStyle === "appointment"
        ? "They book a time that suits them"
        : "Collected in person";
  }
}

function GiftCard({
  item,
  onChoose,
}: {
  item: GiftCatalogItem;
  onChoose: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onChoose}
      className="group flex w-full flex-col overflow-hidden border text-left transition-[border-color,transform] duration-200 hover:border-[color:var(--border-strong)] active:scale-[0.98]"
      style={{ borderColor: "var(--border)", background: "var(--panel)" }}
    >
      {/* Square, not portrait: tall enough to sell a real photo, short
          enough that a grid of photo-less tiles doesn't push the
          names and prices below the fold. */}
      <GiftArt item={item} className="aspect-square w-full" />
      <div className="flex flex-1 flex-col gap-1 p-3 md:p-4">
        <span
          className="text-[10px] tracking-[0.16em] uppercase"
          style={{ color: "var(--gold-dim)" }}
        >
          {CATEGORY_LABEL[item.category]}
        </span>
        <h2
          className="font-display line-clamp-2 text-lg leading-tight md:text-xl"
          style={{ color: "var(--cream)" }}
        >
          {item.name}
        </h2>
        {/* mt-auto pins price to the bottom so a row of cards lines up
            even when one name wraps to two lines and its neighbour's
            doesn't. */}
        <div className="mt-auto flex flex-col gap-0.5 pt-2">
          <span
            className="text-sm font-medium"
            style={{ color: "var(--gold-light)" }}
          >
            {formatNaira(item.basePrice)}
          </span>
          <span
            className="text-[11px] leading-snug"
            style={{ color: "var(--cream-faint)" }}
          >
            {describeCollection(item)}
          </span>
        </div>
      </div>
    </button>
  );
}

/**
 * The picture slot. A real photo when ops has added one; otherwise a
 * designed tile, not an empty frame.
 *
 * An empty bordered square repeated across a grid reads as images that
 * failed to load. This reads as a deliberate, quiet card: the brand's
 * gift mark on a warm glow, with the glow placed differently per
 * category so a grid of stand-ins still has some rhythm. It is the
 * state that ships today, so it has to look like a decision.
 */
const GLOW_POSITION: Record<Category, string> = {
  treats: "30% 25%",
  dine: "70% 25%",
  pamper: "50% 30%",
  experiences: "70% 30%",
  hampers: "30% 70%",
  flowers: "50% 70%",
  utility: "25% 70%",
};

function GiftArt({
  item,
  className,
  large = false,
}: {
  item: GiftCatalogItem;
  className: string;
  large?: boolean;
}) {
  if (item.imageUrl) {
    return (
      <div
        className={`relative overflow-hidden ${className}`}
        style={{ background: "var(--panel-raised)" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- catalogue photos are arbitrary remote URLs set in /ops */}
        <img
          src={item.imageUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
        />
      </div>
    );
  }

  return (
    <div
      aria-hidden="true"
      className={`relative flex items-center justify-center overflow-hidden ${className}`}
      style={{
        background: `radial-gradient(circle at ${GLOW_POSITION[item.category]}, rgba(var(--sendebun-gold-rgb), 0.16), transparent 65%), var(--panel-raised)`,
      }}
    >
      <GiftMark
        className={`${large ? "h-16 w-16" : "h-11 w-11"} text-[color:var(--gold)] opacity-70 transition-transform duration-500 group-hover:scale-110`}
      />
    </div>
  );
}
