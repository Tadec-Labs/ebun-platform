import type { Viewport } from "next";
import { Cormorant_Garamond, DM_Sans } from "next/font/google";
import "@/styles/ebun-consumer-theme.css";

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-cormorant",
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "700"],
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
  themeColor: "#0e0d0b",
};

export default function ConsumerLayout({ children }: LayoutProps<"/">) {
  return (
    <div className={`ebun-consumer-theme ${cormorant.variable} ${dmSans.variable}`}>
      {children}
    </div>
  );
}
