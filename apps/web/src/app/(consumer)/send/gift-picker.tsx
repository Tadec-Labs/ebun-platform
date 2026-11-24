"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import {
  FulfillmentType,
  GIFT_CATEGORY_LABEL,
  OCCASIONS,
  OCCASION_LABEL,
  type Occasion,
} from "@ebun/types";
import { GiftMark } from "@/components/icons";
import { formatNaira } from "@/lib/format-money";
import { availableIn, type GiftCatalogItem } from "@/lib/gifts/types";
import { GREEN, INK_TEXT, IVORY, IVORY_RAISED, LINE, MUTED_TEXT } from "./adire";

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

/** The one price filter: a quick "small treat" cut, in kobo. */
const SMALL_BUDGET = 1_000_000;

/**
 * The gift step's browsing half: heading, moment chips, a price toggle
 * and the grid. Picking a card selects it; the parent shows what that
 * costs in full and what happens next (the side panel on laptops, the
 * bar along the bottom on phones) and owns the Continue.
 *
 * Why select-then-continue rather than tap-to-go: the full price, the
 * refund promise and the next step are what settle a hesitant sender,
 * and they need a moment on screen before the form. It costs one tap.
 *
 * Moments reorder, never filter (the gifts ops tagged come first), so a
 * sender never wonders where something went. The price toggle is the
 * one real filter, and says how to undo itself when it empties the grid.
 */
export function GiftGrid({
  catalog,
  catalogReachable,
  city = null,
  cityName = null,
  title,
  moment,
  onMoment,
  selectedId,
  onSelect,
  notice,
  interlude,
}: {
  catalog: GiftCatalogItem[];
  catalogReachable: boolean;
  /** The recipient's city: cards name the shop that makes it there. */
  city?: string | null;
  cityName?: string | null;
  /** Replaces the heading, e.g. when nothing reaches their city. */
  title?: string;
  moment: Occasion | null;
  onMoment: (moment: Occasion | null) => void;
  selectedId: string | null;
  onSelect: (gift: GiftCatalogItem) => void;
  /** Shown right under the heading (e.g. "tell us your city"). */
  notice?: ReactNode;
  /**
   * A full-width block placed inside the grid after the second row, so
   * gifts come first and this follows as the sender scrolls. Phones and
   * tablets only; laptops have the side panel instead.
   */
  interlude?: ReactNode;
}) {
  const [smallOnly, setSmallOnly] = useState(false);

  // Only moments some gift is tagged for; fixed order from the shared list.
  const moments = useMemo(
    () => OCCASIONS.filter((o) => catalog.some((item) => item.occasions?.includes(o))),
    [catalog],
  );
  // Offer the price toggle only when it would actually split the list.
  const canSplitByPrice =
    catalog.some((item) => item.totalPrice <= SMALL_BUDGET) && catalog.some((item) => item.totalPrice > SMALL_BUDGET);

  // Reorder by moment (matches first, featured first within each group), then filter by price.
  const shown = useMemo(() => {
    const score = (item: GiftCatalogItem) =>
      (moment && item.occasions?.includes(moment) ? 2 : 0) + (item.featured ? 1 : 0);
    return catalog
      .map((item, i) => ({ item, i }))
      .sort((a, b) => score(b.item) - score(a.item) || a.i - b.i)
      .map((x) => x.item)
      .filter((item) => !smallOnly || item.totalPrice <= SMALL_BUDGET);
  }, [catalog, moment, smallOnly]);

  return (
    <section aria-labelledby="gifts-heading" className="flex flex-col">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
        <h1
          id="gifts-heading"
          className="font-display text-[34px] leading-none font-medium tracking-[-0.01em] md:text-[42px]"
        >
          {title ?? (moment ? MOMENT_HEADING[moment] : <>Make someone&rsquo;s <em>day</em></>)}
        </h1>
        {catalog.length > 0 && !title && (
          <div className="flex items-center gap-3 pt-2 md:pt-0">
            <p className="text-[13px]" style={{ color: MUTED_TEXT }}>
              {catalog.length} {catalog.length === 1 ? "gift" : "gifts"}
              {cityName ? ` in ${cityName}` : ""} &middot; prices include delivery
            </p>
            {/* The one real filter sits apart from the moments, which only reorder. */}
            {canSplitByPrice && (
              <Chip active={smallOnly} onClick={() => setSmallOnly((on) => !on)}>
                Under {formatNaira(SMALL_BUDGET)}
              </Chip>
            )}
          </div>
        )}
      </div>

      {notice && <div className="mt-5">{notice}</div>}

      {moments.length > 0 && !title && (
        <div
          role="group"
          aria-label="What's the moment?"
          className="-mx-6 mt-4 flex items-center gap-2 overflow-x-auto px-6 pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0"
        >
          <Chip active={moment === null} onClick={() => onMoment(null)}>
            Anything
          </Chip>
          {moments.map((item) => (
            <Chip key={item} active={moment === item} onClick={() => onMoment(moment === item ? null : item)}>
              {OCCASION_LABEL[item]}
            </Chip>
          ))}
        </div>
      )}

      {catalog.length === 0 ? (
        title ? null : <p className="mt-6 rounded-2xl border p-6 text-center text-sm leading-relaxed" style={{ borderColor: LINE, color: MUTED_TEXT }}>
          {/* Two different problems, two different fixes: nothing on sale vs. a failed load. */}
          {catalogReachable
            ? cityName
              ? `There's nothing to send in ${cityName} just yet. We're adding gifts — check back shortly.`
              : "There's nothing to send just yet. We're adding gifts — check back shortly."
            : "The gift list didn't load. Check your connection and reload the page."}
        </p>
      ) : shown.length === 0 && smallOnly ? (
        <p className="mt-6 rounded-2xl border p-6 text-center text-sm" style={{ borderColor: LINE, color: MUTED_TEXT }}>
          Nothing under {formatNaira(SMALL_BUDGET)} for this yet.{" "}
          <button type="button" onClick={() => setSmallOnly(false)} className="font-medium underline underline-offset-4" style={{ color: GREEN }}>
            Show every price
          </button>
        </p>
      ) : (
        <ul className="mt-5 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
          {shown.map((item, i) => (
            <Fragment key={item.id}>
              <li className="min-w-0">
                <GiftCard item={item} city={city} selected={item.id === selectedId} onSelect={() => onSelect(item)} />
              </li>
              {/* After two rows: 4 cards on phones (2 across), 6 on tablets (3 across). */}
              {interlude && i === 3 && shown.length > 4 && <li className="col-span-2 md:hidden">{interlude}</li>}
              {interlude && i === 5 && shown.length > 6 && (
                <li className="hidden md:col-span-3 md:block lg:hidden">{interlude}</li>
              )}
            </Fragment>
          ))}
        </ul>
      )}

      {/* Too few gifts for two rows: the interlude simply follows the grid. */}
      {interlude && shown.length > 0 && shown.length <= 4 && <div className="mt-5 md:hidden">{interlude}</div>}
      {interlude && shown.length > 0 && shown.length <= 6 && <div className="mt-5 hidden md:block lg:hidden">{interlude}</div>}
    </section>
  );
}

function Chip({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="min-h-10 shrink-0 rounded-full border-[1.5px] px-3.5 text-[13px] whitespace-nowrap transition-colors"
      style={{
        borderColor: active ? GREEN : LINE,
        background: active ? GREEN : "transparent",
        color: active ? IVORY : INK_TEXT,
        fontWeight: active ? 600 : 400,
      }}
    >
      {children}
    </button>
  );
}

function GiftCard({
  item,
  city,
  selected,
  onSelect,
}: {
  item: GiftCatalogItem;
  city: string | null;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className="group flex h-full w-full flex-col overflow-hidden rounded-[18px] border text-left transition-shadow hover:shadow-[0_6px_20px_rgba(14,42,33,0.08)]"
      style={{
        background: IVORY_RAISED,
        borderColor: selected ? GREEN : "#E5DCC6",
        boxShadow: selected ? `0 0 0 1.5px ${GREEN}` : undefined,
      }}
    >
      <span className="relative block">
        <GiftArt item={item} className="aspect-[4/3] w-full" />
        <span
          className="absolute top-2.5 left-2.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
          style={{ background: IVORY_RAISED, color: INK_TEXT }}
        >
          {kindLabel(item)}
        </span>
        {selected && (
          <span
            aria-hidden="true"
            className="absolute top-2.5 right-2.5 flex size-7 items-center justify-center rounded-full"
            style={{ background: GREEN }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={IVORY} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="m5 12 5 5 9-10" />
            </svg>
          </span>
        )}
      </span>
      <span className="flex grow flex-col gap-1 p-3 sm:p-3.5">
        <span className="truncate text-[10.5px] tracking-[0.14em] uppercase sm:text-[11px]" style={{ color: "var(--gold-dim)" }}>
          {makerLabel(item, city)}
        </span>
        <span className="font-display line-clamp-2 text-[19px] leading-tight sm:text-[21px]" style={{ color: INK_TEXT }}>
          {item.name}
        </span>
        <span className="mt-auto flex flex-wrap items-baseline gap-x-1.5 pt-1.5">
          <strong className="text-[15px]" style={{ color: GREEN }}>
            {formatNaira(item.totalPrice)}
          </strong>
          <span className="text-[11px]" style={{ color: MUTED_TEXT }}>
            {item.deliveryFee > 0 ? "incl. delivery" : "all-in"}
          </span>
        </span>
      </span>
    </button>
  );
}

/** The card's corner badge: how it reaches them, from structured fields only. */
export function kindLabel(item: GiftCatalogItem): string {
  if (item.nationwide) return "Instant";
  if (item.deliveryType === FulfillmentType.Physical) return "Delivered";
  return item.bookingStyle === "appointment" ? "Book a time" : "Pick up";
}

/**
 * The small-caps line above a gift's name: the shop that makes it in
 * their city, so the sender knows they're buying from a real local
 * business; "Anywhere in Nigeria" for top-ups; else the category.
 */
export function makerLabel(item: GiftCatalogItem, city: string | null): string {
  if (item.nationwide) return "Anywhere in Nigeria";
  const sellers = city && Array.isArray(item.cities) ? (availableIn(item, city)?.sellers ?? []) : [];
  return sellers.length > 0 ? listShort(sellers, 1) : CATEGORY_LABEL[item.category];
}

/** How the recipient actually gets it, in plain words. */
export function describeCollection(item: GiftCatalogItem, city: string | null = null): string {
  switch (item.deliveryType) {
    case FulfillmentType.Physical: {
      const areas = city ? (availableIn(item, city)?.deliveryAreas ?? []) : [];
      const where = areas.length > 0 ? `Delivers to ${listShort(areas, 2)}` : "Delivered to their door";
      return item.deliveryWindow ? `${where} · ${item.deliveryWindow}` : where;
    }
    case FulfillmentType.Vtu:
      return "Arrives on their line in seconds";
    default:
      return item.bookingStyle === "appointment"
        ? "They book a time that suits them"
        : "Collected in person";
  }
}

/** "Alagbaka, Ijapo +3" — short enough for a card. */
function listShort(items: string[], show: number): string {
  const shown = items.slice(0, show).join(", ");
  return items.length > show ? `${shown} +${items.length - show}` : shown;
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

export function GiftArt({
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
