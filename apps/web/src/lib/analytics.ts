"use client";

import posthog from "posthog-js";

/**
 * Product analytics: which steps people reach and where they stop.
 * Money and orders stay counted in the database (the audit trail);
 * this only answers "what do visitors actually use?".
 *
 * Off unless NEXT_PUBLIC_POSTHOG_KEY is set, so local dev and previews
 * send nothing. Deliberately narrow:
 *   - no autocapture (it would record text typed into forms: names,
 *     phone numbers, gift messages),
 *   - no session recordings,
 *   - no person profiles: visitors are anonymous counts,
 *   - every URL is cleaned first: reveal, redeem, vendor, company,
 *     pot and host links carry secrets in the path, and event slugs
 *     carry people's names.
 */

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com";

let started = false;

export function startAnalytics(): void {
  if (started || !KEY || typeof window === "undefined") return;
  started = true;
  posthog.init(KEY, {
    api_host: HOST,
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    disable_session_recording: true,
    person_profiles: "identified_only",
    persistence: "localStorage",
    // Even PostHog's own properties must not carry a token-bearing URL.
    before_send: (event) => {
      if (!event) return event;
      for (const k of ["$current_url", "$referrer", "$pathname", "$initial_current_url", "$initial_referrer"]) {
        const v = event.properties?.[k];
        if (typeof v === "string") event.properties[k] = cleanUrl(v);
      }
      return event;
    },
  });
}

/** Pages that are never tracked: staff tools. */
const UNTRACKED = /^\/ops(\/|$)/;

/**
 * Path segments that are secrets or personal, replaced by a placeholder.
 * Order matters: the longer prefixes come first.
 */
const SECRET_PATHS: [RegExp, string][] = [
  [/^\/group\/manage\/[^/]+/, "/group/manage/:token"],
  [/^\/group\/m\/[^/]+/, "/group/m/:id"],
  [/^\/group\/[^/]+/, "/group/:token"],
  [/^\/e\/manage\/[^/]+/, "/e/manage/:token"],
  [/^\/e\/h\/[^/]+/, "/e/h/:id"],
  [/^\/e\/[^/]+/, "/e/:slug"],
  [/^\/reveal\/[^/]+/, "/reveal/:token"],
  [/^\/redeem\/[^/]+/, "/redeem/:token"],
  [/^\/vendor\/(?!gifts|earnings|shop)[^/]+/, "/vendor/:token"],
  [/^\/company\/(?!start)[^/]+/, "/company/:token"],
];

export function cleanPath(path: string): string {
  for (const [re, replacement] of SECRET_PATHS) {
    if (re.test(path)) return path.replace(re, replacement);
  }
  return path;
}

/** Only campaign tags survive from a query string; everything else (references, tokens) is dropped. */
const KEPT_PARAMS = ["utm_source", "utm_medium", "utm_campaign", "utm_content"];

export function cleanUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const kept = new URLSearchParams();
    for (const p of KEPT_PARAMS) {
      const v = url.searchParams.get(p);
      if (v) kept.set(p, v);
    }
    const query = kept.toString();
    return `${url.origin}${cleanPath(url.pathname)}${query ? `?${query}` : ""}`;
  } catch {
    return "";
  }
}

export function trackPageview(): void {
  if (!started || UNTRACKED.test(window.location.pathname)) return;
  posthog.capture("$pageview", { $current_url: cleanUrl(window.location.href) });
}

/** The funnel steps worth counting. Properties are labels only, never personal details. */
export type AnalyticsEvent =
  | { name: "launcher_choice"; props: { choice: string } }
  | { name: "send_step"; props: { step: string; group: boolean } }
  | { name: "checkout_started"; props: { flow: "gift" | "pot" | "event_cash" } }
  | { name: "payment_result"; props: { result: "confirmed" | "unsuccessful" | "timeout" } }
  | { name: "gift_scratched"; props: Record<string, never> };

export function track<E extends AnalyticsEvent>(name: E["name"], props: E["props"]): void {
  if (!started || UNTRACKED.test(window.location.pathname)) return;
  posthog.capture(name, { ...props, $current_url: cleanUrl(window.location.href) });
}
