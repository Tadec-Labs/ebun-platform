"use client";

import { useMemo, useState } from "react";
import { FulfillmentType } from "@ebun/types";
import { GiftMark } from "@/components/icons";
import { formatNaira } from "@/lib/format-money";
import type { GiftCatalogItem } from "@/lib/gifts/types";

type Category = GiftCatalogItem["category"];

const CATEGORY_LABEL: Record<Category, string> = {
  food: "Food & drink",
  experience: "Experiences",
  keepsake: "Keepsakes",
  utility: "Airtime & bills",
};

/**
 * The entry point, and the hook.
 *
 * A browsing grid rather than a list: photo first, then a small category
 * line, the name, the price. Senders pick gifts the way people shop —
 * by looking — and a grid shows twice as many options per screen as a
 * list of wide rows, on the phone-sized screen most senders use.
 *
 * Tapping a card IS choosing it. There is no "Add to cart": one order
 * is one gift, so a basket would be a step that does nothing. The
 * choice is shown again, with a way back, on the very next screen.
 *
 * One featured gift (ops' "Featured" toggle) is shown full width above
 * the grid when browsing everything — a starting point for someone who
 * opened the app without a gift in mind, which is most people.
 *
 * Built to hold up with no photographs, because today there are none:
 * see GiftArt for the designed stand-in.
 */
export function GiftPicker({
  catalog,
  catalogReachable,
  onChoose,
}: {
  catalog: GiftCatalogItem[];
  catalogReachable: boolean;
  onChoose: (gift: GiftCatalogItem) => void;
}) {
  const [category, setCategory] = useState<Category | "all">("all");

  const categories = useMemo(
    () => [...new Set(catalog.map((item) => item.category))],
    [catalog],
  );

  const visible =
    category === "all"
      ? catalog
      : catalog.filter((item) => item.category === category);

  // Only lead with a hero when there is enough to browse beneath it —
  // a hero over a single other card is just a big card and a small one.
  const hero =
    category === "all" && visible.length >= 3
      ? (visible.find((item) => item.featured) ?? null)
      : null;
  const grid = hero ? visible.filter((item) => item.id !== hero.id) : visible;

  return (
    <>
      <div className="pb-6">
        <h1
          className="font-display text-3xl leading-tight font-normal md:text-4xl"
          style={{ color: "var(--cream)" }}
        >
          What are you sending?
        </h1>
        <p className="mt-2 text-sm" style={{ color: "var(--cream-dim)" }}>
          Tap a gift to choose it. You&rsquo;ll add your message next.
        </p>
      </div>

      {categories.length > 1 && (
        <div
          className="-mx-7 mb-6 flex gap-2 overflow-x-auto px-7 pb-1 [scrollbar-width:none] md:mx-0 md:px-0"
          role="group"
          aria-label="Filter gifts by category"
        >
          <CategoryChip
            active={category === "all"}
            onClick={() => setCategory("all")}
          >
            Everything
          </CategoryChip>
          {categories.map((item) => (
            <CategoryChip
              key={item}
              active={category === item}
              onClick={() => setCategory(item)}
            >
              {CATEGORY_LABEL[item]}
            </CategoryChip>
          ))}
        </div>
      )}

      {catalog.length === 0 ? (
        <div
          className="mb-12 border p-6 text-center text-sm leading-relaxed"
          style={{ borderColor: "var(--border)", color: "var(--cream-dim)" }}
        >
          {/*
            Two different problems with two different fixes. Telling
            someone to check their connection when the real answer is
            that nothing is on sale sends them chasing a fault that
            isn't theirs — and hides, from whoever is debugging, the
            one state they most need to see.
          */}
          {catalogReachable
            ? "There's nothing to send just yet. We're adding gifts — check back shortly."
            : "The gift list didn't load. Check your connection and reload the page."}
        </div>
      ) : (
        <div className="flex flex-col gap-3 pb-14 md:gap-4">
          {hero && <HeroCard item={hero} onChoose={() => onChoose(hero)} />}
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4">
            {grid.map((item) => (
              <li key={item.id} className="flex">
                <GiftCard item={item} onChoose={() => onChoose(item)} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function CategoryChip({
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
      className="shrink-0 border px-4 py-2 text-xs tracking-wide whitespace-nowrap transition-colors"
      style={{
        borderColor: active ? "var(--gold)" : "var(--border)",
        background: active ? "var(--gold-glow)" : "transparent",
        color: active ? "var(--gold-light)" : "var(--cream-dim)",
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
        ? `Delivered in ${item.deliveryWindow}`
        : "Delivered";
    case FulfillmentType.Vtu:
      return "Arrives on their line in seconds";
    default:
      return "Collected in person";
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

function HeroCard({
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
      className="group flex w-full flex-col overflow-hidden border text-left transition-[border-color,transform] duration-200 hover:border-[color:var(--border-strong)] active:scale-[0.99] md:flex-row"
      style={{
        borderColor: "var(--border-strong)",
        background: "var(--panel)",
      }}
    >
      <GiftArt
        item={item}
        // A shorter band when there's no photo: the stand-in tile has
        // nothing to show at full height.
        className={`${item.imageUrl ? "aspect-[16/10]" : "aspect-[2/1]"} w-full md:aspect-auto md:w-1/2 md:self-stretch`}
        large
      />
      <div className="flex flex-1 flex-col gap-2 p-5 md:justify-center md:p-8">
        <span
          className="text-[10px] tracking-[0.16em] uppercase"
          style={{ color: "var(--gold)" }}
        >
          A good place to start
        </span>
        <h2
          className="font-display text-3xl leading-tight md:text-4xl"
          style={{ color: "var(--cream)" }}
        >
          {item.name}
        </h2>
        {item.description && (
          <p
            className="line-clamp-3 text-sm leading-relaxed"
            style={{ color: "var(--cream-dim)" }}
          >
            {item.description}
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span
            className="text-base font-medium"
            style={{ color: "var(--gold-light)" }}
          >
            {formatNaira(item.basePrice)}
          </span>
          <span className="text-xs" style={{ color: "var(--cream-faint)" }}>
            {describeCollection(item)}
          </span>
        </div>
        <span
          className="mt-3 self-start border-b pb-0.5 text-xs tracking-wide transition-colors group-hover:text-[color:var(--cream)]"
          style={{ borderColor: "var(--gold-dim)", color: "var(--gold-light)" }}
        >
          Send this &rarr;
        </span>
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
  food: "30% 25%",
  experience: "70% 30%",
  keepsake: "50% 70%",
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
        background: `radial-gradient(circle at ${GLOW_POSITION[item.category]}, rgba(201,168,76,0.16), transparent 65%), var(--panel-raised)`,
      }}
    >
      <GiftMark
        className={`${large ? "h-16 w-16" : "h-11 w-11"} text-[color:var(--gold)] opacity-70 transition-transform duration-500 group-hover:scale-110`}
      />
    </div>
  );
}
