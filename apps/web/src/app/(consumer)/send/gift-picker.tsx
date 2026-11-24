"use client";

import { useMemo } from "react";
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
import { CHAMPAGNE, GOLD, GREEN, IVORY, SMALL_CAPS } from "./adire";

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

/**
 * The gift step is one screen in two parts: this heading and its moment
 * tabs on the green band, and GiftList on the ivory sheet below. The
 * moment lives in the parent so both halves share it.
 *
 * Choosing a moment never hides anything; it reorders, so the gifts ops
 * tagged for that moment come first. "Anything" (the default) shows the
 * catalogue as ops ordered it.
 */
export function GiftHeading({
  catalog,
  moment,
  onMoment,
  title,
}: {
  catalog: GiftCatalogItem[];
  moment: Occasion | null;
  onMoment: (moment: Occasion | null) => void;
  /** Replaces the heading, e.g. when there is nothing to show for their city. */
  title?: string;
}) {
  // Only moments some gift is tagged for; fixed order from the shared list.
  const moments = useMemo(
    () => OCCASIONS.filter((o) => catalog.some((item) => item.occasions?.includes(o))),
    [catalog],
  );

  return (
    <>
      <h1
        id="gifts-heading"
        className="font-display mt-5 text-[42px] leading-[0.95] font-medium tracking-[-0.01em] md:text-[56px]"
      >
        {title ?? (moment ? MOMENT_HEADING[moment] : <>Make someone&rsquo;s <em>day</em></>)}
      </h1>

      {moments.length > 0 && !title && (
        <div
          className="-mx-6 mt-3 flex gap-6 overflow-x-auto px-6 [scrollbar-width:none] md:mx-0 md:px-0"
          role="group"
          aria-label="What's the moment?"
        >
          <Tab active={moment === null} onClick={() => onMoment(null)}>
            Anything
          </Tab>
          {moments.map((item) => (
            <Tab key={item} active={moment === item} onClick={() => onMoment(moment === item ? null : item)}>
              {OCCASION_LABEL[item]}
            </Tab>
          ))}
        </div>
      )}
    </>
  );
}

/** Editorial tabs: plain words with a gold underline, not pill buttons. */
function Tab({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="min-h-11 shrink-0 border-b-2 text-sm whitespace-nowrap transition-colors"
      style={{
        borderColor: active ? GOLD : "transparent",
        color: active ? IVORY : CHAMPAGNE,
        fontWeight: active ? 600 : 400,
      }}
    >
      {children}
    </button>
  );
}

/**
 * The list, on the ivory sheet. The first gift (the best match for the
 * moment, else the first ops featured) is the feature: a big photo and
 * a magazine-style caption. Every other gift is a numbered row: photo,
 * name, maker, how it arrives, price. Rows fit four or more gifts on a
 * phone screen where cards fit one and a half, which matters more as
 * the catalogue grows. Two columns of rows from md up.
 */
export function GiftList({
  catalog,
  catalogReachable,
  city = null,
  cityName = null,
  moment,
  onChoose,
}: {
  catalog: GiftCatalogItem[];
  catalogReachable: boolean;
  /** The recipient's city: rows say which shop makes it and where it's delivered there. */
  city?: string | null;
  cityName?: string | null;
  moment: Occasion | null;
  onChoose: (gift: GiftCatalogItem, moment: Occasion | null) => void;
}) {
  // Reorder, never filter: matches first, featured first within each group.
  const ordered = useMemo(() => {
    const score = (item: GiftCatalogItem) =>
      (moment && item.occasions?.includes(moment) ? 2 : 0) + (item.featured ? 1 : 0);
    return catalog
      .map((item, i) => ({ item, i }))
      .sort((a, b) => score(b.item) - score(a.item) || a.i - b.i)
      .map((x) => x.item);
  }, [catalog, moment]);

  if (catalog.length === 0) {
    return (
      <p className="mb-8 rounded-2xl border p-6 text-center text-sm leading-relaxed" style={{ borderColor: "var(--border)", color: "var(--cream-dim)" }}>
        {/* Two different problems, two different fixes: nothing on sale vs. a failed load. */}
        {catalogReachable
          ? cityName
            ? `There's nothing to send in ${cityName} just yet. We're adding gifts — check back shortly.`
            : "There's nothing to send just yet. We're adding gifts — check back shortly."
          : "The gift list didn't load. Check your connection and reload the page."}
      </p>
    );
  }

  const [feature, ...rest] = ordered;
  const choose = (gift: GiftCatalogItem) => onChoose(gift, moment);

  return (
    <div className="flex flex-col pb-4">
      <FeatureGift item={feature} city={city} onChoose={() => choose(feature)} />
      {rest.length > 0 && (
        <ul aria-label="More gifts" className="mt-6 grid grid-cols-1 border-t md:grid-cols-2 md:gap-x-10" style={{ borderColor: "var(--border)" }}>
          {rest.map((item, i) => (
            <li key={item.id} className="min-w-0 border-b" style={{ borderColor: "var(--border)" }}>
              <GiftRow item={item} number={i + 2} city={city} onChoose={() => choose(item)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "No. 02" — the editorial numbering, two digits. */
function numberLabel(n: number): string {
  return `No. ${String(n).padStart(2, "0")}`;
}

function FeatureGift({ item, city, onChoose }: { item: GiftCatalogItem; city: string | null; onChoose: () => void }) {
  return (
    <button
      type="button"
      onClick={onChoose}
      className="group flex w-full flex-col text-left transition-transform active:scale-[0.99] md:flex-row md:items-end md:gap-8"
    >
      <GiftArt item={item} className="aspect-[16/10] w-full rounded-[20px] md:w-[56%]" large />
      <span className="flex flex-col gap-1.5 pt-4 md:flex-1 md:pt-0">
        <span className={SMALL_CAPS} style={{ color: "var(--gold-dim)" }}>
          {numberLabel(1)} · {makerLabel(item, city)}
        </span>
        <span className="font-display text-[32px] leading-none md:text-[40px]" style={{ color: "var(--cream)" }}>
          {item.name}
        </span>
        <span className="text-[13px]" style={{ color: "var(--cream-dim)" }}>
          {describeCollection(item, city)}
        </span>
        <span className="flex items-center justify-between pt-4">
          <span className="font-display text-[26px] font-semibold" style={{ color: GREEN }}>
            {formatNaira(item.basePrice)}
          </span>
          <span className="rounded-full px-5 py-3 text-sm font-semibold" style={{ background: GREEN, color: IVORY }}>
            Send this
          </span>
        </span>
      </span>
    </button>
  );
}

function GiftRow({
  item,
  number,
  city,
  onChoose,
}: {
  item: GiftCatalogItem;
  number: number;
  city: string | null;
  onChoose: () => void;
}) {
  return (
    <button type="button" onClick={onChoose} className="group flex w-full items-center gap-3.5 py-4 text-left">
      <GiftArt item={item} className="size-[84px] shrink-0 rounded-2xl" />
      <span className="flex min-w-0 grow flex-col gap-0.5">
        <span className="truncate text-[11px] tracking-[0.14em] uppercase" style={{ color: "var(--gold-dim)" }}>
          {numberLabel(number)} · {makerLabel(item, city)}
        </span>
        <span className="font-display line-clamp-2 text-[22px] leading-tight" style={{ color: "var(--cream)" }}>
          {item.name}
        </span>
        <span className="line-clamp-1 text-xs" style={{ color: "var(--cream-dim)" }}>
          {describeCollection(item, city)}
        </span>
        <span className="text-[15px] font-semibold" style={{ color: GREEN }}>
          {formatNaira(item.basePrice)}
        </span>
      </span>
      <span className="shrink-0 rounded-full px-4 py-2.5 text-[13px] font-semibold" style={{ background: GREEN, color: IVORY }}>
        Send
      </span>
    </button>
  );
}

/**
 * The small-caps line above a gift's name: the shop that makes it in
 * their city, so the sender knows they're buying from a real local
 * business; "Anywhere in Nigeria" for top-ups; else the category.
 */
function makerLabel(item: GiftCatalogItem, city: string | null): string {
  if (item.nationwide) return "Anywhere in Nigeria";
  const sellers = city && Array.isArray(item.cities) ? (availableIn(item, city)?.sellers ?? []) : [];
  return sellers.length > 0 ? listShort(sellers, 1) : CATEGORY_LABEL[item.category];
}

/**
 * How the recipient actually gets it, in their words. Each fulfilment
 * type is genuinely different: a voucher is collected in person, a
 * top-up just arrives, a physical gift is delivered.
 */
function describeCollection(item: GiftCatalogItem, city: string | null = null): string {
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
