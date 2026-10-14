"use client";

import Link, { useLinkStatus } from "next/link";
import { Spinner } from "@/components/ui/feedback";

const LINKS = [
  { href: "/vendor", label: "Orders", icon: "M4 6h16M4 12h16M4 18h10" },
  { href: "/vendor/gifts", label: "Items", icon: "M4 10h16v10H4zM3 7h18v3H3zM12 7v13" },
  { href: "/vendor/earnings", label: "Earnings", icon: "M3 7h18v12H3zM3 11h18M7 15h3" },
  { href: "/vendor/shop", label: "Shop", icon: "M4 10l1-5h14l1 5M4 10h16v10H4zM9 20v-5h6v5" },
] as const;

/**
 * A bottom tab bar, like every app on the phone this runs on: all four
 * screens always visible, the current one marked, thumb-reachable. It
 * used to list only the OTHER screens as underlined text, which never
 * said where you were. A tapped tab shows a spinner until its page
 * arrives, so a slow connection doesn't look like a dead button.
 */
export function VendorNav({ current }: { current: (typeof LINKS)[number]["href"] }) {
  return (
    <nav
      aria-label="SendEbun partner"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-zinc-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      <ul className="mx-auto grid max-w-md grid-cols-4">
        {LINKS.map((link) => {
          const active = link.href === current;
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`flex flex-col items-center gap-1 py-2.5 text-xs font-medium ${
                  active ? "text-zinc-900" : "text-zinc-500"
                }`}
              >
                <Icon d={link.icon} active={active} />
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function Icon({ d, active }: { d: string; active: boolean }) {
  const { pending } = useLinkStatus();
  if (pending) return <Spinner className="h-6 w-6" />;
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-6 w-6 ${active ? "" : "opacity-80"}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={active ? 2.2 : 1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}
