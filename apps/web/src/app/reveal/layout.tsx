import type { Viewport } from "next";
import { Cormorant_Garamond, DM_Sans } from "next/font/google";
import "./reveal-theme.css";

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

// Overrides the root layout's viewport for this route tree only. The
// reveal screen is a full-bleed, phone-shaped experience opened from a
// WhatsApp link, so it needs safe-area awareness the marketing/app
// shell doesn't.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0e0d0b",
};

export default function RevealLayout({ children }: LayoutProps<"/reveal">) {
  return (
    <div className={`ebun-reveal-theme ${cormorant.variable} ${dmSans.variable}`}>
      {children}
    </div>
  );
}
