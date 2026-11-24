"use client";

import Link from "next/link";
import { useId, type CSSProperties, type ReactNode } from "react";
import { BrandLogo } from "@/components/brand-logo";

/*
 * The look of /send's first step (the city screen and the gift list):
 * forest green with an adire-style pattern on top, an ivory sheet with
 * a gold edge underneath, and editorial type (large Cormorant
 * headlines, small-caps labels, hairline rules).
 *
 * Literal hex, not theme variables, because this step inverts the
 * consumer theme; the message and pay steps are still dark. Every text
 * pairing here is WCAG AA or better (lowest: gold eyebrow on green, 5.3:1).
 */
export const GREEN = "#004B35";
export const IVORY = "#F7F2E6";
export const IVORY_RAISED = "#FFFDF8";
export const CHAMPAGNE = "#F3E2BC";
export const GOLD = "#E4B454";
export const INK_TEXT = "#0E2A21";
export const MUTED_TEXT = "#4A5E55";
export const LABEL_GOLD = "#7A5C14";
export const LINE = "#D9CFB8";

/**
 * Re-points the theme's roles at ivory-friendly colours inside the sheet,
 * so shared components (OtherWays, PolicyLinks, ElsewhereNote, the gift
 * art) read correctly on a light surface without a "light" variant each.
 */
export const SHEET_THEME = {
  "--ink": IVORY,
  "--deep": "#EFE7D4",
  "--panel": IVORY_RAISED,
  "--panel-raised": "#EFE7D4",
  "--cream": INK_TEXT,
  "--cream-dim": MUTED_TEXT,
  "--cream-faint": MUTED_TEXT,
  "--gold": GREEN,
  "--gold-light": GREEN,
  "--gold-dim": LABEL_GOLD,
  "--border": LINE,
  "--border-strong": LINE,
  "--focus-ring": GREEN,
} as CSSProperties;

/** Small caps label: the editorial voice for eyebrows, numbers and makers. */
export const SMALL_CAPS = "text-xs tracking-[0.14em] uppercase";

/**
 * The pattern: an original motif in the spirit of adire (ringed circles,
 * corner dots, short ticks), tone on tone so it reads as texture and
 * never competes with text. Drawn rather than copied from any real
 * cloth. Pure SVG: no image request, sharp at any size, ~1 KB.
 */
export function AdirePattern() {
  // useId gives ":r1:"-style ids; colons break url(#…) references.
  const id = `adire-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full">
      <defs>
        <pattern id={id} width="56" height="56" patternUnits="userSpaceOnUse">
          <circle cx="28" cy="28" r="13" fill="none" stroke="#0D6A4D" strokeWidth="2" />
          <circle cx="28" cy="28" r="5" fill="#0D6A4D" />
          <circle cx="0" cy="0" r="2.5" fill="#0D6A4D" />
          <circle cx="56" cy="0" r="2.5" fill="#0D6A4D" />
          <circle cx="0" cy="56" r="2.5" fill="#0D6A4D" />
          <circle cx="56" cy="56" r="2.5" fill="#0D6A4D" />
          <path d="M6 28h4M46 28h4M28 6v4M28 46v4" stroke="#0D6A4D" strokeWidth="2" strokeLinecap="round" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

/**
 * Full-bleed green page. The theme wrapper pads for the notch and home
 * bar in its own (darker) colour; this bleeds through that padding so
 * the green runs to the top edge and the ivory to the bottom.
 */
export function AdireScreen({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`flex min-h-dvh flex-col ${className}`}
      style={{
        background: GREEN,
        color: IVORY,
        marginTop: "calc(-1 * env(safe-area-inset-top, 0px))",
        paddingTop: "env(safe-area-inset-top, 0px)",
        marginBottom: "calc(-1 * env(safe-area-inset-bottom, 0px))",
      }}
    >
      {children}
    </div>
  );
}

/**
 * Logo, "For companies" and the step, each on a solid green pill so they
 * stay crisp over the pattern.
 */
export function BandHeader({ companiesOpen, logoHref = "/" }: { companiesOpen: boolean; logoHref?: string }) {
  return (
    <header className="flex items-center justify-between gap-3">
      <span className="rounded-full py-1 pr-3 pl-1" style={{ background: GREEN }}>
        <BrandLogo size="sm" href={logoHref} />
      </span>
      <div className="flex items-center gap-2 text-xs tracking-wide whitespace-nowrap" style={{ color: CHAMPAGNE }}>
        {companiesOpen && (
          <Link
            href="/company/start"
            className="rounded-full px-3 py-1.5 underline-offset-4 hover:underline"
            style={{ background: GREEN }}
          >
            For companies
          </Link>
        )}
        {/* "Step" drops on small phones so the row never wraps. */}
        <p className="rounded-full px-3 py-1.5" style={{ background: GREEN }}>
          <span className="hidden sm:inline">Step </span>1 of 3
        </p>
      </div>
    </header>
  );
}

/**
 * The ivory sheet: rounded top and a gold edge on phones. Pass
 * className to change its shape at larger sizes (the city screen turns
 * it into the right-hand column).
 */
export function Sheet({
  children,
  labelledBy,
  className = "",
  innerClassName = "max-w-[440px]",
}: {
  children: ReactNode;
  labelledBy?: string;
  className?: string;
  innerClassName?: string;
}) {
  return (
    <section
      aria-labelledby={labelledBy}
      className={`flex grow flex-col rounded-t-[28px] border-t-4 px-6 pt-6 ${className}`}
      style={{
        ...SHEET_THEME,
        background: IVORY,
        color: INK_TEXT,
        borderColor: GOLD,
        paddingBottom: "calc(2rem + env(safe-area-inset-bottom, 0px))",
      }}
    >
      <div className={`mx-auto flex w-full grow flex-col ${innerClassName}`}>{children}</div>
    </section>
  );
}

export function Arrow({ color }: { color: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
