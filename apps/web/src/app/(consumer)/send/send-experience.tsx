"use client";

import { BrandLogo } from "@/components/brand-logo";
import { OtherWays } from "@/components/other-ways";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { PolicyLinks } from "@/components/policy-links";
import { track } from "@/lib/analytics";
import type { City } from "@/lib/cities/cities";
import type { Occasion } from "@ebun/types";
import { reachesCity, type GiftCatalogItem } from "@/lib/gifts/types";
import { OCCASIONS as OCCASION_LIST, type OccasionId } from "@/lib/occasions";

import { CityBar, CityScreen, ElsewhereNote } from "./city-picker";
import { Compose, type MessageDraft } from "./compose";
import { AdirePattern, AdireScreen, BandHeader, Sheet } from "./adire";
import { GiftHeading, GiftList } from "./gift-picker";
import { ReviewAndPay } from "./review-and-pay";
import { StartGroupGift } from "./start-group-gift";

const MESSAGE_OCCASIONS = OCCASION_LIST.map((o) => o.id);

type Phase = "gift" | "compose" | "pay";

export interface SendDraft {
  /**
   * Where the recipient is. A city slug, "elsewhere" (a city we don't
   * serve yet: nationwide gifts only), or null until the sender says.
   */
  city: string | "elsewhere" | null;
  occasion: OccasionId | null;
  gift: GiftCatalogItem | null;
  message: MessageDraft;
  /** Starting a group gift: the last step sets up the pot instead of paying. */
  group: boolean;
}

const EMPTY_MESSAGE: MessageDraft = {
  recipientName: "",
  recipientPhone: "",
  messageType: "text",
  text: "",
  recordedMedia: null,
  sendTiming: "now",
  scheduledFor: "",
  knowsAddress: false,
  deliveryAddress: "",
  deliveryArea: "",
  deliveryNote: "",
};

/** The last city chosen on this phone: marked on the city screen as "Last time". */
const CITY_KEY = "sendebun.city";

function rememberedCity(): string | null {
  try {
    return window.localStorage.getItem(CITY_KEY);
  } catch {
    return null;
  }
}

/** Storage isn't an event source we listen to; the snapshot is re-read on every render. */
function noSubscription(): () => void {
  return () => undefined;
}

function rememberCity(slug: string | null): void {
  try {
    if (slug) window.localStorage.setItem(CITY_KEY, slug);
    else window.localStorage.removeItem(CITY_KEY);
  } catch {
    // Private mode or storage off: the sender just picks again next time.
  }
}

const PHASES: { id: Phase; label: string }[] = [
  { id: "gift", label: "Gift" },
  { id: "compose", label: "Message" },
  { id: "pay", label: "Pay" },
];

/**
 * Three steps, down from four.
 *
 * The flow this replaces opened on an occasion picker, which was a full
 * gate that collected nothing — CreateOrderDto has no occasion field,
 * so its entire effect was choosing a message placeholder. For a
 * product whose competition is a bank transfer (a number, an amount, a
 * tap), a screen that costs the sender a decision and returns no value
 * is the most expensive thing in the app. The occasion now sits beside
 * the message box, doing its one real job.
 *
 * Recipient details moved in with the message because "who it's for and
 * what I want to say" is one thought, not two.
 *
 * Still one client component across phases, same reasoning as
 * reveal-experience.tsx: this is one form that submits as a single
 * POST /orders, not several independently-navigable pages.
 */
export function SendExperience({
  catalog,
  catalogReachable,
  cities: loadedCities = [],
  allowScheduling,
  allowRecordings,
  companiesOpen,
  groupGifting = false,
  eventsOpen = false,
}: {
  catalog: GiftCatalogItem[];
  catalogReachable: boolean;
  /** Cities SendEbun is open in (GET /cities); null when the list couldn't load. */
  cities?: City[] | null;
  /** "Send later" only exists while Ebun delivers the message itself. */
  allowScheduling: boolean;
  /** Voice and video tabs — off until media storage is live (MEDIA_MESSAGES). */
  allowRecordings: boolean;
  /** /company/start is open (CORPORATE_SELF_SERVE): link to it from the gift list. */
  companiesOpen: boolean;
  /** "Chip in with friends" in the message step (GROUP_GIFTING). */
  groupGifting?: boolean;
  /** /events/new is open (EVENTS): link to it under More ways. */
  eventsOpen?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("gift");
  // The gift step's moment tab; shared by the heading and the list.
  const [moment, setMoment] = useState<Occasion | null>(null);
  const [draft, setDraft] = useState<SendDraft>({
    city: null,
    occasion: null,
    gift: null,
    message: EMPTY_MESSAGE,
    group: false,
  });
  const currentPhaseIndex = PHASES.findIndex((item) => item.id === phase);
  const citiesFailed = loadedCities === null;
  const cities = loadedCities ?? [];

  // The city chosen on this phone last time, if we still serve it. Only
  // marked on the city screen, never filled in: the city is the
  // recipient's, and a repeat sender is often gifting someone else
  // somewhere else. Read through useSyncExternalStore so the server
  // render (no storage) and the first client render agree.
  const saved = useSyncExternalStore(noSubscription, rememberedCity, () => null);
  const lastCity = saved && cities.some((c) => c.slug === saved) ? saved : null;
  const city = draft.city;

  const cityName = cities.find((c) => c.slug === city)?.name ?? null;
  const recipientCity = city && city !== "elsewhere" ? city : null;

  // Only what can reach them: shop gifts in their city, plus the
  // nationwide ones. "Somewhere else" leaves just the nationwide ones.
  const reachable = useMemo(() => {
    if (!city) return [];
    return catalog.filter((item) => reachesCity(item, recipientCity));
  }, [catalog, city, recipientCity]);

  const chooseCity = (slug: string | "elsewhere" | null) => {
    rememberCity(slug && slug !== "elsewhere" ? slug : null);
    setDraft((prev) => ({
      ...prev,
      city: slug,
      // A gift chosen for another city may not reach this one.
      gift: null,
      message: { ...prev.message, deliveryArea: "" },
    }));
    if (slug) track("city_chosen", { city: slug });
  };

  // Each step is a new screen to the sender, but it's the same page to
  // the browser, so scroll position carried over: tapping a gift low in
  // the grid opened the message step halfway down its form, past the
  // recipient fields. Start every step at the top. Instant, not smooth —
  // a smooth scroll on a screen that has just changed reads as lag.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [phase]);

  // Which step people reach is the funnel: gift → message → pay.
  useEffect(() => {
    track("send_step", { step: phase, group: draft.group });
    // draft.group is read at the moment the step opens, not tracked on its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // The first screen has its own full-bleed layout; see CityScreen.
  if (phase === "gift" && !city) {
    return (
      <CityScreen
        cities={cities}
        failed={citiesFailed}
        hasNationwide={catalog.some((item) => item.nationwide)}
        companiesOpen={companiesOpen}
        eventsOpen={eventsOpen}
        lastCity={lastCity}
        onChoose={(choice) => chooseCity(choice.slug)}
        onElsewhere={() => chooseCity("elsewhere")}
      />
    );
  }

  // The gift list: the same green band and ivory sheet as the city
  // screen, so the first step reads as one place.
  if (phase === "gift") {
    const nothingThere = city === "elsewhere" && reachable.length === 0;
    return (
      <AdireScreen>
        <div className="relative">
          <AdirePattern />
          <div className="relative mx-auto w-full max-w-[488px] px-6 pt-6 md:max-w-[928px]">
            <BandHeader companiesOpen={companiesOpen} />
            <div className="pt-8">
              <CityBar label={cityName ?? "anywhere in Nigeria"} onChange={() => chooseCity(null)} />
            </div>
          </div>
        </div>
        <div className="mx-auto w-full max-w-[488px] px-6 pb-5 md:max-w-[928px]">
          <GiftHeading
            catalog={reachable}
            moment={moment}
            onMoment={setMoment}
            title={nothingThere ? "We\u2019re not there yet" : undefined}
          />
        </div>
        <Sheet labelledBy="gifts-heading" innerClassName="max-w-[440px] md:max-w-[880px]">
          {city === "elsewhere" && (
            <ElsewhereNote
              cities={cities}
              hasNationwide={reachable.length > 0}
              onServedCity={(slug) => chooseCity(slug)}
            />
          )}
          {!nothingThere && (
            <GiftList
              catalog={reachable}
              catalogReachable={catalogReachable}
              city={recipientCity}
              cityName={cityName}
              moment={moment}
              onChoose={(gift, chosenMoment) => {
                // Carry the moment into the message prompt where the two lists overlap.
                const occasion =
                  chosenMoment && (MESSAGE_OCCASIONS as readonly string[]).includes(chosenMoment)
                    ? (chosenMoment as OccasionId)
                    : null;
                setDraft((prev) => ({ ...prev, gift, occasion: prev.occasion ?? occasion }));
                setPhase("compose");
              }}
            />
          )}
          <div className="mt-auto">
            <OtherWays companiesOpen={companiesOpen} eventsOpen={eventsOpen} />
            <PolicyLinks className="pt-6" />
          </div>
        </Sheet>
      </AdireScreen>
    );
  }

  return (
    // The writing and paying steps stay phone-width, where a form reads
    // best whatever the screen.
    <div className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col px-7">
      <header className="pt-5 pb-7">
        <div className="flex items-center justify-between">
          {/* The logo always goes back to the front door. Past the first
              step it asks first, so a stray tap can't throw away a draft. */}
          <span
            onClickCapture={(e) => {
              if (!window.confirm("Leave this gift? What you've written won't be saved.")) {
                e.preventDefault();
              }
            }}
          >
            <BrandLogo size="sm" />
          </span>
          <div className="flex items-center gap-4">
            <p className="text-[11px] tracking-wide" style={{ color: "var(--cream-dim)" }}>
              Step {currentPhaseIndex + 1} of {PHASES.length}
            </p>
          </div>
        </div>
        <ol className="mt-4 grid grid-cols-3 gap-1.5" aria-label="Send a gift progress">
          {PHASES.map((item, index) => {
            const isCurrent = index === currentPhaseIndex;
            const isComplete = index < currentPhaseIndex;
            return (
              <li key={item.id}>
                <span className="sr-only">
                  {item.label}: {isComplete ? "complete" : isCurrent ? "current step" : "upcoming"}
                </span>
                <span
                  aria-hidden="true"
                  className="block h-px"
                  style={{
                    background: isCurrent || isComplete ? "var(--gold)" : "var(--border-strong)",
                    opacity: isCurrent ? 1 : isComplete ? 0.65 : 0.5,
                  }}
                />
              </li>
            );
          })}
        </ol>
      </header>

      {phase === "compose" && draft.gift && (
        <Compose
          gift={draft.gift}
          city={recipientCity}
          draft={draft.message}
          occasion={draft.occasion}
          onChangeDraft={(message) => setDraft((prev) => ({ ...prev, message }))}
          onChangeOccasion={(occasion) => setDraft((prev) => ({ ...prev, occasion }))}
          onChangeGift={() => setPhase("gift")}
          allowScheduling={allowScheduling}
          allowRecordings={allowRecordings}
          allowGroup={groupGifting}
          groupMode={draft.group}
          onChangeGroupMode={(group) => setDraft((prev) => ({ ...prev, group }))}
          onContinue={() => setPhase("pay")}
        />
      )}

      {phase === "pay" && draft.gift && draft.group && (
        <StartGroupGift gift={draft.gift} message={draft.message} onBack={() => setPhase("compose")} />
      )}

      {phase === "pay" && draft.gift && !draft.group && (
        <ReviewAndPay
          gift={draft.gift}
          city={recipientCity}
          message={draft.message}
          onBack={() => setPhase("compose")}
        />
      )}
    </div>
  );
}
