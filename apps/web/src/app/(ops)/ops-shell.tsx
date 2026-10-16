"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Spinner, ToastProvider } from "@/components/ui/feedback";
import type { OpsCounts } from "@/lib/ops/types";
import { getOpsCountsAction, logoutAction } from "./ops/actions";

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  badge?: (c: OpsCounts) => number;
  /** Badge colour: red for "act now", grey for "worth a look". */
  urgent?: boolean;
};

const icon = (d: string) => (
  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

const GROUPS: { label: string | null; items: NavItem[] }[] = [
  {
    label: null,
    items: [
      { href: "/ops", label: "Today", icon: icon("M3 11l9-7 9 7M5 10v10h14V10"), badge: (c) => c.attention, urgent: true },
    ],
  },
  {
    label: "Orders",
    items: [
      { href: "/ops/orders", label: "All orders", icon: icon("M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01") },
      { href: "/ops/deliveries", label: "Deliveries", icon: icon("M3 7h11v9H3zM14 10h4l3 3v3h-7M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"), badge: (c) => c.deliveries, urgent: true },
      { href: "/ops/redeem", label: "Redeem a code", icon: icon("M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM14 18h2") },
    ],
  },
  {
    label: "Partners",
    items: [
      { href: "/ops/vendors", label: "Partners", icon: icon("M4 10l1-5h14l1 5M4 10h16v10H4zM9 20v-5h6v5"), badge: (c) => c.approvals },
      { href: "/ops/payouts", label: "Payouts", icon: icon("M3 7h18v12H3zM3 11h18M7 15h3"), badge: (c) => c.payouts },
    ],
  },
  {
    label: "Companies",
    items: [
      { href: "/ops/campaigns", label: "Campaigns", icon: icon("M3 21h18M5 21V7l7-4 7 4v14M9 9h1M14 9h1M9 13h1M14 13h1M10 21v-4h4v4") },
    ],
  },
  {
    label: "Catalogue",
    items: [
      { href: "/ops/gifts", label: "Gifts", icon: icon("M4 10h16v10H4zM3 7h18v3H3zM12 7v13M12 7c-2-3-6-3-6 0M12 7c2-3 6-3 6 0") },
    ],
  },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/ops") return pathname === "/ops";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The /ops frame: a dark sidebar on desktop, a scrolling tab strip on a
 * phone. Grouped by job (orders, partners, catalogue) rather than by
 * database table, with live counts on the things that are waiting for
 * someone — so the first thing ops sees is where to go, not a list of
 * pages.
 *
 * Counts are re-read on every navigation: the layout around this doesn't
 * re-render between pages, so a server-fetched count would go stale the
 * moment someone acted on it.
 */
export function OpsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [counts, setCounts] = useState<OpsCounts | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getOpsCountsAction().then((next) => {
      if (!cancelled) setCounts(next);
    });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  const items = GROUPS.flatMap((g) => g.items);

  // A stale session cookie lands here on the login page: no shell around
  // a sign-in form.
  if (pathname.startsWith("/ops/login")) {
    return (
      <div className="min-h-dvh bg-zinc-50 text-sm text-zinc-900">
        <main className="mx-auto max-w-md px-5 py-16">{children}</main>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-zinc-50 text-sm text-zinc-900 md:flex">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col bg-zinc-950 text-zinc-300 md:flex">
        <Link href="/ops" className="flex items-center gap-2.5 px-5 pt-6 pb-5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#C9A84C] font-semibold text-zinc-950">
            E
          </span>
          <span className="leading-tight">
            <span className="block font-semibold text-white">SendEbun</span>
            <span className="block text-xs text-zinc-500">Operations</span>
          </span>
        </Link>
        <nav className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 pb-4">
          {GROUPS.map((group, i) => (
            <div key={group.label ?? i} className="flex flex-col gap-0.5">
              {group.label && (
                <p className="px-2 pb-1 text-[11px] font-medium tracking-wider text-zinc-500 uppercase">{group.label}</p>
              )}
              {group.items.map((item) => (
                <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} counts={counts} />
              ))}
            </div>
          ))}
        </nav>
        <form action={logoutAction} className="border-t border-zinc-800 px-3 py-3">
          <button type="submit" className="w-full rounded-lg px-2 py-2 text-left text-zinc-400 hover:bg-zinc-900 hover:text-white">
            Sign out
          </button>
        </form>
      </aside>

      {/* Phone: top bar + scrolling tabs */}
      <div className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950 md:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="font-semibold text-white">SendEbun Ops</span>
          <form action={logoutAction}>
            <button type="submit" className="text-zinc-400">
              Sign out
            </button>
          </form>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 [scrollbar-width:none]">
          {items.map((item) => {
            const active = isActive(pathname, item.href);
            const n = counts && item.badge ? item.badge(counts) : 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 whitespace-nowrap ${
                  active ? "bg-zinc-800 text-white" : "text-zinc-400"
                }`}
              >
                {item.label}
                <PendingOr>{n > 0 && <Badge n={n} urgent={item.urgent} />}</PendingOr>
              </Link>
            );
          })}
        </nav>
      </div>

      <main className="min-w-0 flex-1">
        <ToastProvider>
          <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">{children}</div>
        </ToastProvider>
      </main>
    </div>
  );
}

function NavLink({ item, active, counts }: { item: NavItem; active: boolean; counts: OpsCounts | null }) {
  const n = counts && item.badge ? item.badge(counts) : 0;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`relative flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors ${
        active ? "bg-zinc-800 text-white" : "hover:bg-zinc-900 hover:text-white"
      }`}
    >
      {active && <span className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-[#C9A84C]" aria-hidden="true" />}
      {item.icon}
      <span className="flex-1">{item.label}</span>
      <PendingOr>{n > 0 && <Badge n={n} urgent={item.urgent} />}</PendingOr>
    </Link>
  );
}

/**
 * Inside a <Link>: a spinner while that link's page is loading, so a tap
 * on a slow connection visibly did something; otherwise its children.
 */
function PendingOr({ children }: { children: React.ReactNode }) {
  const { pending } = useLinkStatus();
  return pending ? <Spinner className="h-3.5 w-3.5 text-zinc-400" /> : <>{children}</>;
}

function Badge({ n, urgent }: { n: number; urgent?: boolean }) {
  return (
    <span
      className={`min-w-5 rounded-full px-1.5 py-0.5 text-center text-[11px] leading-none font-semibold tabular-nums ${
        urgent ? "bg-red-500 text-white" : "bg-zinc-700 text-zinc-100"
      }`}
    >
      {n > 99 ? "99+" : n}
    </span>
  );
}
