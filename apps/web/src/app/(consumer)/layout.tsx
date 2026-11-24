import type { Viewport } from "next";
import localFont from "next/font/local";
import "@/styles/ebun-consumer-theme.css";

/*
 * The brand fonts ship inside the repo (./fonts) rather than through
 * next/font/google. That loader downloads from Google at build time,
 * and on 24 Nov 2026 Google's response for Cormorant Garamond started
 * failing every production build ("next/font/google queries have
 * exactly one entry"). Local files remove the network from the build.
 *
 * Each file is the official variable font from github.com/google/fonts,
 * cut down with fontTools to Latin, Latin Extended, Yoruba tone marks
 * and dotted letters (Ọlá, Adéwálé), currency signs including ₦, and
 * arrows. One file covers every weight. Licences: OFL, beside the files.
 * DM Sans itself has no ₦ or dotted letters; those fall back to the
 * system font, as they did before.
 */
const cormorant = localFont({
  src: [
    { path: "./fonts/cormorant-garamond.woff2", weight: "300 700", style: "normal" },
    { path: "./fonts/cormorant-garamond-italic.woff2", weight: "300 700", style: "italic" },
  ],
  variable: "--font-cormorant",
  display: "swap",
  adjustFontFallback: "Times New Roman",
});

const dmSans = localFont({
  src: "./fonts/dm-sans.woff2",
  weight: "100 1000",
  variable: "--font-dm-sans",
  display: "swap",
});

// Overrides the root layout's viewport for every route in this group.
// These are phone-shaped experiences reached from a WhatsApp link (or,
// for /send, used from any phone), so they need safe-area awareness
// the marketing/app shell doesn't.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#091C17",
};

export default function ConsumerLayout({ children }: LayoutProps<"/">) {
  return (
    <div className={`ebun-consumer-theme ${cormorant.variable} ${dmSans.variable}`}>
      {children}
    </div>
  );
}
