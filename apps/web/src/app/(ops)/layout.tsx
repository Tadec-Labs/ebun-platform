import type { Metadata } from "next";
import Link from "next/link";
import { getOpsToken } from "@/lib/ops/session";
import { logoutAction } from "./ops/actions";

export const metadata: Metadata = {
  title: "Ebun Ops",
  // Internal tool — keep it out of every index.
  robots: { index: false, follow: false },
};

/**
 * Deliberately NOT the consumer brand (dark/gold/serif): this is an
 * internal, dense, utilitarian tool that should read as one at a glance,
 * and it has its own route group so none of the consumer theme or fonts
 * load here. Explicit colours rather than inheriting the root layout's
 * prefers-color-scheme variables, so it looks the same on any device.
 */
export default async function OpsLayout({ children }: LayoutProps<"/">) {
  const signedIn = (await getOpsToken()) !== null;

  return (
    <div className="min-h-dvh bg-zinc-50 text-sm text-zinc-900">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-3">
          <div className="flex items-center gap-6">
            <span className="font-semibold tracking-tight">Ebun Ops</span>
            {signedIn && (
              <nav className="flex gap-4 text-zinc-600">
                <Link href="/ops/vendors" className="hover:text-zinc-900">
                  Vendors
                </Link>
                <Link href="/ops/gifts" className="hover:text-zinc-900">
                  Gifts
                </Link>
                <Link href="/ops/redeem" className="hover:text-zinc-900">
                  Redeem
                </Link>
              </nav>
            )}
          </div>
          {signedIn && (
            <form action={logoutAction}>
              <button type="submit" className="text-zinc-600 hover:text-zinc-900">
                Sign out
              </button>
            </form>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-5 py-8">{children}</main>
    </div>
  );
}
