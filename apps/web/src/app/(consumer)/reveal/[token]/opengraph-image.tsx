import { ImageResponse } from "next/og";

/**
 * The image in the WhatsApp preview card for every reveal link.
 *
 * Same for every gift, and built without reading the token or calling
 * the API — see the comment on this route's metadata for why nothing
 * per-order belongs in a preview, and lib/link-preview-bot.ts for why
 * fetching this must never touch the order.
 *
 * Drawn in code rather than shipped as a PNG so it stays in the brand
 * palette when that changes. Uses ImageResponse's built-in sans rather
 * than Cormorant: a custom font would have to be fetched at render
 * time, and a preview that fails because a font download failed is
 * worse than a plainer one.
 */
export const alt = "You’ve been sent a gift on Ebun";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#0e0d0b";
const GOLD = "#c9a84c";
const CREAM = "#f5efe0";

export default function RevealPreviewImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: `radial-gradient(circle at 50% 42%, rgba(201,168,76,0.22), ${INK} 62%)`,
        color: CREAM,
      }}
    >
      <svg
        width="132"
        height="132"
        viewBox="0 0 48 48"
        fill="none"
        stroke={GOLD}
        strokeWidth="1.2"
      >
        <rect x="8" y="18" width="32" height="22" />
        <path d="M8 26h32" />
        <path d="M24 18v22" />
        <path d="M24 18c-3.5 0-7-2-7-6a4 4 0 0 1 7-2.5A4 4 0 0 1 31 12c0 4-3.5 6-7 6Z" />
      </svg>
      <div style={{ marginTop: 40, fontSize: 68, letterSpacing: -1 }}>
        You’ve been sent a gift
      </div>
      <div
        style={{ marginTop: 28, fontSize: 26, letterSpacing: 10, color: GOLD }}
      >
        EBUN
      </div>
    </div>,
    size,
  );
}
