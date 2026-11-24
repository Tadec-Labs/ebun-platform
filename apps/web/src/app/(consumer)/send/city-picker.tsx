"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { OtherWays } from "@/components/other-ways";
import { PolicyLinks } from "@/components/policy-links";
import { track } from "@/lib/analytics";
import { matchCity, requestCity, type City } from "@/lib/cities/cities";
import { readRecent, recentSnapshot } from "@/lib/recent";
import { LANDING_URL } from "@/lib/site-links";
import {
  AdirePattern,
  AdireScreen,
  Arrow,
  BandHeader,
  CHAMPAGNE,
  GOLD,
  GREEN,
  INK_TEXT,
  IVORY,
  IVORY_RAISED,
  LABEL_GOLD,
  LINE,
  MUTED_TEXT,
  SMALL_CAPS,
  Sheet,
} from "./adire";

/**
 * "Where are they?" — asked before any gift is shown.
 *
 * One tap, and it earns its place: every gift on the next screen can
 * actually reach that city, so nobody pays for an Akure spa day for
 * someone in Lagos.
 *
 * Green with the adire pattern above, the ivory sheet of choices below
 * (see ./adire). From lg (1024px) up the two halves sit side by side,
 * so a laptop doesn't get a 440px strip floating in empty space.
 * Tablets keep the phone layout: split at 820px, the headline wrapped.
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
    <AdireScreen className="lg:grid lg:grid-cols-2">
      <div className="relative lg:sticky lg:top-0 lg:h-dvh">
        <AdirePattern />
        <div className="relative mx-auto flex w-full max-w-[440px] flex-col px-6 pt-6 pb-10 lg:h-full lg:max-w-none lg:px-12 lg:py-10 xl:px-16">
          {/* The front door's way out is the main site, as the launcher's was. */}
          <BandHeader companiesOpen={companiesOpen} logoHref={LANDING_URL} />
          {/* A solid panel, so the headline never sits on the pattern. */}
          <div className="mt-16 self-start rounded-[20px] px-5 py-5 lg:my-auto lg:px-8 lg:py-8" style={{ background: GREEN }}>
            <p className={SMALL_CAPS} style={{ color: GOLD }}>
              Gift like you&rsquo;re there
            </p>
            <h1
              id="city-heading"
              className="font-display pt-2 text-[56px] leading-[0.95] font-medium tracking-[-0.01em] lg:text-[84px]"
            >
              Where are <br />
              <em>they</em>?
            </h1>
            <p className="pt-3 text-[15px] leading-relaxed" style={{ color: CHAMPAGNE }}>
              We&rsquo;ll only show gifts that can reach them.
            </p>
          </div>
        </div>
      </div>

      <Sheet
        labelledBy="city-heading"
        className="lg:min-h-dvh lg:justify-center lg:rounded-none lg:border-t-0 lg:border-l-4 lg:px-12 lg:py-16 xl:px-16"
        innerClassName="max-w-[440px] lg:grow-0"
      >
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
                  className="flex w-full items-center gap-4 rounded-[20px] border-2 p-[18px] text-left transition-transform hover:-translate-y-px active:scale-[0.99]"
                  style={{ borderColor: GREEN, background: IVORY_RAISED, color: INK_TEXT }}
                >
                  <span
                    aria-hidden="true"
                    className="font-display flex size-[50px] shrink-0 items-center justify-center rounded-full text-[26px]"
                    style={{ background: GREEN, color: GOLD, boxShadow: `0 0 0 3px ${IVORY_RAISED}, 0 0 0 5px ${GOLD}` }}
                  >
                    {city.name.charAt(0)}
                  </span>
                  <span className="flex min-w-0 grow flex-col gap-1">
                    <span className="flex items-center gap-2">
                      <span className="font-display text-[30px] leading-none">{city.name}</span>
                      {city.slug === lastCity && (
                        <span
                          className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                          style={{ background: CHAMPAGNE, color: GREEN }}
                        >
                          Last time
                        </span>
                      )}
                    </span>
                    <span className={SMALL_CAPS} style={{ color: LABEL_GOLD }}>
                      {city.state ? `${city.state} · ` : ""}Gifts, treats &amp; more
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
                className="flex w-full items-center gap-4 rounded-[20px] border-[1.5px] p-[18px] text-left transition-colors hover:border-[#004B35]"
                style={{ borderColor: LINE, color: INK_TEXT }}
              >
                <span
                  aria-hidden="true"
                  className="flex size-[50px] shrink-0 items-center justify-center rounded-full"
                  style={{ background: CHAMPAGNE }}
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
                  </svg>
                </span>
                <span className="flex min-w-0 grow flex-col gap-1">
                  <span className="font-display text-[24px] leading-tight">Anywhere else in Nigeria</span>
                  <span className={SMALL_CAPS} style={{ color: LABEL_GOLD }}>
                    {hasNationwide ? "Airtime · data · power" : "Tell us where to go next"}
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
      </Sheet>
    </AdireScreen>
  );
}

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

/**
 * The chosen city, small, with a way back. Sits on the green band
 * above the gift list, on its own pill so it stays crisp over the pattern.
 */
export function CityBar({ label, onChange }: { label: string; onChange: () => void }) {
  return (
    <p
      className="inline-flex flex-wrap items-center gap-x-2 rounded-full px-4 py-1.5 text-[13px]"
      style={{ background: GREEN, color: CHAMPAGNE }}
    >
      <span>
        Gifts for <strong style={{ color: IVORY, fontWeight: 600 }}>{label}</strong>
      </span>
      <span aria-hidden="true">&middot;</span>
      <button
        type="button"
        onClick={onChange}
        className="min-h-7 font-medium underline underline-offset-4"
        style={{ color: GOLD }}
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
