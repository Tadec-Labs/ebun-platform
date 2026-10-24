import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { LANDING_URL } from "@/lib/site-links";

export const metadata: Metadata = {
  title: "Your SendEbun campaign",
  // A private, per-company tool.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#fafaf9",
};

/**
 * The company's workspace. Light and plain, like ops, not the dark
 * recipient theme: an HR manager fills this in at a desk, often with a
 * spreadsheet open beside it, and reads a report from it later. The
 * dark-and-gold moment belongs to the people receiving the gifts.
 */
export default function CompanyLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="min-h-dvh bg-stone-50 text-sm text-zinc-900">
      {/* Dark bar: the logo is drawn for dark surfaces. */}
      <header className="bg-zinc-950">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-5 py-3">
          {/* Safe to leave: the company's link lives in a cookie, so /company brings them straight back. */}
          <BrandLogo size="sm" href={LANDING_URL} />
          <nav aria-label="SendEbun" className="flex items-center gap-4 text-xs">
            <span className="hidden text-zinc-400 sm:inline">For companies</span>
            <Link href="/send" className="text-zinc-200 underline-offset-4 hover:underline">
              Send a personal gift
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl px-5 py-8">{children}</main>
    </div>
  );
}
