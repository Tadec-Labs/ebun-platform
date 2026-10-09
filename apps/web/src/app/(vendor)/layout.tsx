import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Ebun — collect a gift",
  // A private per-vendor tool. Nothing here belongs in an index.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

/**
 * Deliberately not the consumer theme, and not the ops theme either.
 *
 * This runs on a counter phone held at arm's length, often outdoors in
 * Lagos daylight, by someone with one hand free. So: white background
 * and near-black text for the highest contrast available, type a size
 * up from anything else in the product, and touch targets sized for a
 * thumb rather than a cursor. The dark-and-gold brand is for the
 * recipient's moment; a vendor needs to read a code in the sun.
 */
export default function VendorLayout({ children }: LayoutProps<"/"> ) {
  return (
    <div className="min-h-dvh bg-white text-zinc-900">
      <div className="mx-auto w-full max-w-md px-5 pb-16">{children}</div>
    </div>
  );
}
