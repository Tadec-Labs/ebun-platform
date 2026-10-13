import Link from "next/link";

const LINKS = [
  { href: "/vendor", label: "Collect" },
  { href: "/vendor/gifts", label: "Items" },
  { href: "/vendor/earnings", label: "Earnings" },
  { href: "/vendor/shop", label: "Shop" },
] as const;

/** The counter link's four screens, minus the one you're on. Thumb-sized, like everything here. */
export function VendorNav({ current }: { current: (typeof LINKS)[number]["href"] }) {
  return (
    <nav className="flex flex-wrap gap-x-4 gap-y-1">
      {LINKS.filter((link) => link.href !== current).map((link) => (
        <Link key={link.href} href={link.href} className="text-base font-medium text-zinc-900 underline underline-offset-4">
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
