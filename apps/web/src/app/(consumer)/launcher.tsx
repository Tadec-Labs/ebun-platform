"use client";

import Link from "next/link";
import { useMemo, useSyncExternalStore } from "react";
import { BrandLogo } from "@/components/brand-logo";
import { readRecent, recentSnapshot } from "@/lib/recent";

// Nothing else writes the list while the launcher is open.
const subscribe = () => () => undefined;

const icon = (d: string, dark = false) => (
  <svg
    viewBox="0 0 24 24"
    className="h-6 w-6"
    fill="none"
    stroke={dark ? "var(--ink)" : "var(--gold-light)"}
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d={d} />
  </svg>
);

const GIFT = "M20 12v9H4v-9M2 7h20v5H2zM12 21V7M12 7H7.5a2.5 2.5 0 1 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 1 0 0-5C13 2 12 7 12 7z";
const EVENT = "M3 5h18v16H3zM3 10h18M8 3v4M16 3v4M12 13.5l1 2 2.2.3-1.6 1.5.4 2.2-2-1.1-2 1.1.4-2.2-1.6-1.5 2.2-.3z";
const TEAM = "M3 21h18M5 21V7l7-4 7 4v14M9 9h1M14 9h1M9 13h1M14 13h1M10 21v-4h4v4";

export function Launcher({ eventsOpen, companiesOpen }: { eventsOpen: boolean; companiesOpen: boolean }) {
  // The server has no localStorage: it renders none, the browser fills them in.
  const raw = useSyncExternalStore(subscribe, recentSnapshot, () => "");
  const recent = useMemo(() => readRecent(raw), [raw]);

  const tiles = [
    { href: "/send", title: "Someone", hint: "Alone or with friends", d: GIFT, show: true },
    { href: "/events/new", title: "An event", hint: "Wedding, birthday, naming…", d: EVENT, show: eventsOpen },
    { href: "/company/start", title: "My team or clients", hint: "One payment, everyone chooses", d: TEAM, show: companiesOpen },
  ].filter((t) => t.show);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col gap-8 px-7 pb-10">
      <header className="pt-5">
        <BrandLogo size="sm" href={null} />
      </header>

      <h1 className="font-display mt-6 text-4xl leading-tight font-normal" style={{ color: "var(--cream)" }}>
        Who&rsquo;s it <span style={{ color: "var(--gold-light)" }}>for?</span>
      </h1>

      <nav aria-label="Choose" className="flex flex-col gap-3">
        {tiles.map((t, i) => (
          <Link
            key={t.href}
            href={t.href}
            className="flex items-center gap-4 border p-5 transition-colors"
            style={{ borderColor: i === 0 ? "var(--border-strong)" : "var(--border)", background: "var(--panel)" }}
          >
            <span
              className="flex h-12 w-12 flex-shrink-0 items-center justify-center"
              style={{ background: i === 0 ? "var(--gold)" : "var(--panel-raised)" }}
            >
              {icon(t.d, i === 0)}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-lg font-medium" style={{ color: "var(--cream)" }}>
                {t.title}
              </span>
              <span className="text-xs" style={{ color: "var(--cream-dim)" }}>
                {t.hint}
              </span>
            </span>
            <span aria-hidden="true" style={{ color: "var(--gold-light)" }}>
              →
            </span>
          </Link>
        ))}
      </nav>

      {recent.length > 0 && (
        <section className="mt-auto flex flex-col gap-2.5">
          <p className="text-[11px] tracking-[0.14em] uppercase" style={{ color: "var(--gold)" }}>
            Continue
          </p>
          {recent.map((r) => (
            <Link
              key={r.path}
              href={r.path}
              className="flex items-center justify-between gap-3 px-4 py-3.5 text-sm"
              style={{ background: "var(--deep)", color: "var(--cream)" }}
            >
              <span className="truncate">{r.title}</span>
              <span className="text-[11px]" style={{ color: "var(--cream-dim)" }}>
                {r.kind === "event" ? "Event" : "Group gift"}
              </span>
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}
