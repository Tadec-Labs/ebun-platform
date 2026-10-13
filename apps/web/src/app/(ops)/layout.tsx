import type { Metadata } from "next";
import { getOpsToken } from "@/lib/ops/session";
import { OpsShell } from "./ops-shell";

export const metadata: Metadata = {
  title: { default: "SendEbun Ops", template: "%s · SendEbun Ops" },
  // Internal tool — keep it out of every index.
  robots: { index: false, follow: false },
};

/**
 * Deliberately NOT the consumer brand (dark/gold/serif) for the working
 * area: this is a dense, utilitarian tool that should read as one at a
 * glance, and it has its own route group so none of the consumer theme
 * or fonts load here. The sidebar carries a touch of the brand gold so
 * it still feels like SendEbun. Explicit colours rather than inheriting
 * the root layout's prefers-color-scheme variables, so it looks the same
 * on any device.
 *
 * Signed out (the login page), there is no shell: nothing to navigate to.
 */
export default async function OpsLayout({ children }: LayoutProps<"/">) {
  const signedIn = (await getOpsToken()) !== null;

  if (!signedIn) {
    return (
      <div className="min-h-dvh bg-zinc-50 text-sm text-zinc-900">
        <main className="mx-auto max-w-md px-5 py-16">{children}</main>
      </div>
    );
  }

  return <OpsShell>{children}</OpsShell>;
}
