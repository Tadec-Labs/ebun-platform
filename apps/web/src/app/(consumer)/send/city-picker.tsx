"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore, type CSSProperties } from "react";
import { BrandLogo } from "@/components/brand-logo";
import { OtherWays } from "@/components/other-ways";
import { PolicyLinks } from "@/components/policy-links";
import { track } from "@/lib/analytics";
import { matchCity, requestCity, type City } from "@/lib/cities/cities";
import { readRecent, recentSnapshot } from "@/lib/recent";
import { LANDING_URL } from "@/lib/site-links";

/*
 * The city screen's palette: forest green above, an ivory sheet below.
 * Literal hex, not theme variables, because this one screen inverts the
 * theme — the rest of /send is still dark. Every pairing used here is
 * WCAG AA or better (lowest: gold eyebrow on green, 5.3:1).
 */
const GREEN = "#004B35";
const IVORY = "#F7F2E6";
const IVORY_RAISED = "#FFFDF8";
const INK_TEXT = "#0E2A21";
const MUTED_TEXT = "#4A5E55";
const LINE = "#D9CFB8";

/**
 * Re-points the theme's roles at ivory-friendly colours inside the sheet,
 * so the shared OtherWays and PolicyLinks components read correctly on a
 * light surface without growing a "light" variant of their own.
 */
const SHEET_THEME = {
  "--ink": IVORY,
  "--panel": IVORY_RAISED,
  "--cream": INK_TEXT,
  "--cream-dim": MUTED_TEXT,
  "--cream-faint": MUTED_TEXT,
  "--gold": GREEN,
  "--gold-light": GREEN,
  "--gold-dim": "#7A5C14",
  "--border": LINE,
  "--border-strong": LINE,
  "--focus-ring": GREEN,
} as CSSProperties;

function Arrow({ color }: { color: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="shrink-0">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

/**
 * "Where are they?" — asked before any gift is shown.
 *
 * One tap, and it earns its place: every gift on the next screen can
 * actually reach that city, so nobody pays for an Akure spa day for
 * someone in Lagos.
 *
 * It is the first thing a sender sees, so it gets its own full-bleed
 * layout (green top, ivory sheet) instead of the step container the
 * rest of /send uses. On a phone the sheet sits under the question;
 * from lg (1024px) up the two halves sit side by side, so a laptop
 * doesn't get a 440px strip floating in empty space. Tablets keep the
 * phone layout: split at 820px, the headline wrapped to three lines.
 *
 * It is also the app's front door ("/" redirects here), so it carries
 * what the old "Who's it for?" launcher did: events and team gifting
 * under "More ways", and "Continue" for things started on this phone.
 */
export function CityScreen({
  cities,
  failed = false,
  hasNationwide = false,
  companiesOpen,
  eventsOpen = false,
  lastCity = null,
  onChoose,
  onElsewhere,
}: {
  cities: City[];
  /** The city list didn't load: say so, rather than offering only "Anywhere else". */
  failed?: boolean;
  /** Airtime, data or power are on sale: they reach anyone, so say so up front. */
  hasNationwide?: boolean;
  /** /company/start is open (CORPORATE_SELF_SERVE). */
  companiesOpen: boolean;
  /** /events/new is open (EVENTS). */
  eventsOpen?: boolean;
  /**
   * The city picked last time on this phone. Marked, never pre-selected:
   * the city belongs to whoever receives the gift, and that changes
   * from one gift to the next.
   */
  lastCity?: string | null;
  onChoose: (city: City) => void;
  onElsewhere: () => void;
}) {
  return (
    <div
      className="flex min-h-dvh flex-col lg:grid lg:grid-cols-2"
      style={{
        background: GREEN,
        color: IVORY,
        // The theme wrapper pads for the notch and home bar in its own
        // (darker) colour. Bleed through that padding so the green runs
        // to the top edge and the ivory to the bottom, not a dark band.
        marginTop: "calc(-1 * env(safe-area-inset-top, 0px))",
        paddingTop: "env(safe-area-inset-top, 0px)",
        marginBottom: "calc(-1 * env(safe-area-inset-bottom, 0px))",
      }}
    >
      <div className="mx-auto flex w-full max-w-[440px] flex-col px-6 pt-6 lg:sticky lg:top-0 lg:h-dvh lg:max-w-none lg:px-12 lg:py-10 xl:px-16">
        <header className="flex items-center justify-between">
          {/* The front door's way out is the main site, as the launcher's was. */}
          <BrandLogo size="sm" href={LANDING_URL} />
          <div className="flex items-center gap-4 text-xs tracking-wide">
            {companiesOpen && (
              <Link href="/company/start" className="underline-offset-4 hover:underline" style={{ color: "#F3E2BC" }}>
                For companies
              </Link>
            )}
            <p style={{ color: "#F3E2BC" }}>Step 1 of 3</p>
          </div>
        </header>
        <div className="flex flex-col gap-2.5 pt-14 pb-10 lg:my-auto lg:max-w-[460px] lg:pt-0 lg:pb-0">
          <p className="text-xs tracking-[0.14em] uppercase" style={{ color: "#E4B454" }}>
            Gift like you&rsquo;re there
          </p>
          <h1 id="city-heading" className="font-display text-[50px] leading-none font-medium lg:text-[76px]">
            Where are <br />
            <em>they</em>?
          </h1>
          <p className="pt-2 text-[15px] leading-relaxed" style={{ color: "#F3E2BC" }}>
            We&rsquo;ll only show gifts that can reach them.
          </p>
        </div>
      </div>

      <section
        aria-labelledby="city-heading"
        className="flex grow flex-col rounded-t-[32px] px-5 pt-3.5 lg:min-h-dvh lg:justify-center lg:rounded-none lg:px-12 lg:py-16 xl:px-16"
        style={{
          ...SHEET_THEME,
          background: IVORY,
          color: INK_TEXT,
          paddingBottom: "calc(2rem + env(safe-area-inset-bottom, 0px))",
        }}
      >
        <div className="mx-auto flex w-full max-w-[440px] grow flex-col lg:grow-0">
          <span aria-hidden="true" className="mb-3.5 h-1 w-10 self-center rounded-full lg:hidden" style={{ background: LINE }} />

          {failed ? (
            <div className="flex flex-col items-start gap-4 py-2">
              <p className="text-[15px] leading-relaxed" style={{ color: MUTED_TEXT }}>
                We couldn&rsquo;t load the cities we deliver to. Check your connection and try again.
              </p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="min-h-11 rounded-full px-6 text-sm font-medium"
                style={{ background: GREEN, color: IVORY }}
              >
                Try again
              </button>
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {cities.map((city) => (
                <li key={city.slug}>
                  <button
                    type="button"
                    onClick={() => onChoose(city)}
                    className="flex w-full items-center gap-3.5 rounded-[20px] border-2 p-[18px] text-left transition-transform hover:-translate-y-px active:scale-[0.99]"
                    style={{ borderColor: GREEN, background: IVORY_RAISED, color: INK_TEXT }}
                  >
                    <span
                      aria-hidden="true"
                      className="font-display flex size-12 shrink-0 items-center justify-center rounded-[14px] text-[26px]"
                      style={{ background: GREEN, color: "#E4B454" }}
                    >
                      {city.name.charAt(0)}
                    </span>
                    <span className="flex grow flex-col gap-0.5">
                      <span className="flex items-center gap-2">
                        <span className="text-lg font-semibold">{city.name}</span>
                        {city.slug === lastCity && (
                          <span
                            className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                            style={{ background: "#F3E2BC", color: GREEN }}
                          >
                            Last time
                          </span>
                        )}
                      </span>
                      <span className="text-[13px]" style={{ color: MUTED_TEXT }}>
                        Gifts, treats &amp; experiences
                      </span>
                    </span>
                    <Arrow color={GREEN} />
                  </button>
                </li>
              ))}
              <li>
                <button
                  type="button"
                  onClick={onElsewhere}
                  className="flex w-full items-center gap-3.5 rounded-[20px] border-[1.5px] p-[18px] text-left transition-colors hover:border-[#004B35]"
                  style={{ borderColor: LINE, color: INK_TEXT }}
                >
                  <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-[14px]" style={{ background: "#F3E2BC" }}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
                    </svg>
                  </span>
                  <span className="flex grow flex-col gap-0.5">
                    <span className="text-lg font-semibold">Anywhere else in Nigeria</span>
                    <span className="text-[13px]" style={{ color: MUTED_TEXT }}>
                      {hasNationwide ? "Airtime, data or power, instantly" : "Tell us where, and we'll let you know when we arrive"}
                    </span>
                  </span>
                  <Arrow color={MUTED_TEXT} />
                </button>
              </li>
            </ul>
          )}

          {!failed && (
            <p className="pt-5 text-center text-[13px]" style={{ color: MUTED_TEXT }}>
              Your city next?{" "}
              <button type="button" onClick={onElsewhere} className="font-medium underline underline-offset-4" style={{ color: GREEN }}>
                Let us know
              </button>
            </p>
          )}

          {/* Pushed to the foot of the sheet on a tall phone, so the
              choice above is all the first glance takes in. */}
          <div className="mt-auto">
            <ContinueList />
            <OtherWays companiesOpen={companiesOpen} eventsOpen={eventsOpen} />
            <PolicyLinks className="pt-6" />
          </div>
        </div>
      </section>
    </div>
  );
}

// Nothing else writes the recent list while this screen is open.
const noSubscription = () => () => undefined;

/**
 * "Pick up where you left off": events and group gifts opened on this
 * phone (see lib/recent). Moved here from the old launcher. Renders
 * nothing until the browser has read storage, and nothing at all for
 * most people, who have none.
 */
function ContinueList() {
  const raw = useSyncExternalStore(noSubscription, recentSnapshot, () => "");
  const recent = useMemo(() => readRecent(raw), [raw]);
  if (recent.length === 0) return null;
  return (
    <section aria-label="Continue" className="mt-10 flex flex-col gap-2.5">
      <p className="text-[11px] tracking-[0.14em] uppercase" style={{ color: "var(--gold-dim)" }}>
        Continue
      </p>
      {recent.map((r) => (
        <Link
          key={r.path}
          href={r.path}
          className="flex min-h-11 items-center justify-between gap-3 rounded-2xl px-4 py-3.5 text-sm"
          style={{ background: "#EFE7D4", color: INK_TEXT }}
        >
          <span className="truncate">{r.title}</span>
          <span className="text-[11px]" style={{ color: MUTED_TEXT }}>
            {r.kind === "event" ? "Event" : "Group gift"}
          </span>
        </Link>
      ))}
    </section>
  );
}

/** The chosen city, small, with a way back. Sits above the gift list. */
export function CityBar({ label, onChange }: { label: string; onChange: () => void }) {
  return (
    <p className="flex items-center gap-2 pb-4 text-xs" style={{ color: "var(--cream-dim)" }}>
      <span>
        Gifts for someone in <strong style={{ color: "var(--cream)", fontWeight: 500 }}>{label}</strong>
      </span>
      <span aria-hidden="true">&middot;</span>
      <button
        type="button"
        onClick={onChange}
        className="underline underline-offset-4"
        style={{ color: "var(--gold-light)" }}
      >
        Change
      </button>
    </p>
  );
}

/**
 * Their city isn't open yet. Honest about it, asks where (that list
 * decides which city opens next), and offers what does work anywhere.
 */
export function ElsewhereNote({
  cities,
  hasNationwide,
  onServedCity,
}: {
  cities: City[];
  hasNationwide: boolean;
  /** They typed a city we do serve ("Akure"): take them straight to its gifts. */
  onServedCity: (slug: string) => void;
}) {
  const [city, setCity] = useState("");
  const [contact, setContact] = useState("");
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  if (sent) {
    return (
      <div className="mb-8 border p-5 text-sm leading-relaxed" style={{ borderColor: "var(--border)", color: "var(--cream-dim)" }}>
        Thank you. {contact.trim() ? "We'll let you know when we arrive in " : "We've noted "}
        <strong style={{ color: "var(--cream)", fontWeight: 500 }}>{city.trim()}</strong>
        {contact.trim() ? "." : " — it helps us decide where to open next."}
        {hasNationwide && " Meanwhile, the gifts below reach anyone, anywhere in Nigeria."}
      </div>
    );
  }

  return (
    <form
      className="mb-8 flex flex-col gap-3 border p-5"
      style={{ borderColor: "var(--border)" }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (city.trim().length < 2 || sending) return;
        const served = matchCity(cities, city);
        if (served) {
          onServedCity(served.slug);
          return;
        }
        setSending(true);
        await requestCity({ city: city.trim(), contact: contact.trim() || undefined });
        track("city_requested", {});
        setSent(true);
      }}
    >
      <p className="text-sm leading-relaxed" style={{ color: "var(--cream-dim)" }}>
        We&rsquo;re not delivering gifts there yet.
        {hasNationwide ? " The gifts below reach anyone in Nigeria. " : " "}
        Tell us where they are and we&rsquo;ll let you know when we arrive.
      </p>
      <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--cream-faint)" }}>
        Their city
        <input
          value={city}
          onChange={(e) => setCity(e.target.value)}
          maxLength={80}
          required
          autoComplete="address-level2"
          placeholder="e.g. Ibadan"
          className="border bg-transparent px-3 py-2.5 text-sm"
          style={{ borderColor: "var(--border-strong)", color: "var(--cream)" }}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--cream-faint)" }}>
        Your WhatsApp or email (optional)
        <input
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          maxLength={254}
          className="border bg-transparent px-3 py-2.5 text-sm"
          style={{ borderColor: "var(--border-strong)", color: "var(--cream)" }}
        />
      </label>
      <button
        type="submit"
        disabled={city.trim().length < 2 || sending}
        className="self-start px-4 py-2 text-xs font-medium tracking-wide disabled:opacity-50"
        style={{ background: "var(--gold)", color: "var(--ink)" }}
      >
        {sending ? "Sending…" : "Let me know"}
      </button>
    </form>
  );
}
