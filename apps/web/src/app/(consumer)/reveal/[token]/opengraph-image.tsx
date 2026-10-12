import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

/**
 * The image in the WhatsApp preview card for every reveal link — the
 * first thing a recipient ever sees of SendEbun, before they tap.
 *
 * Same for every gift, and built without reading the token or calling
 * the API — see the comment on this route's metadata for why nothing
 * per-order belongs in a preview, and lib/link-preview-bot.ts for why
 * fetching this must never touch the order.
 *
 * Brand colours are literal hex (ImageResponse can't read CSS
 * variables) mirroring styles/brand/colors.json. The symbol is the same
 * crop the app uses, on its light tile, per the brand kit.
 */
export const alt = "You’ve been sent a gift on SendEbun";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BACKGROUND = "#091C17";
const TEXT = "#F5F1E7";
const AMBER = "#FFAE00";
const GOLD_RGB = "228,180,84";

export default async function RevealPreviewImage() {
  const symbol = await readFile(
    join(process.cwd(), "public/brand/sendebun-symbol.png"),
  );
  const symbolSrc = `data:image/png;base64,${symbol.toString("base64")}`;

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: `radial-gradient(circle at 50% 40%, rgba(${GOLD_RGB},0.09), ${BACKGROUND} 62%)`,
        color: TEXT,
      }}
    >
      <img
        src={symbolSrc}
        width={150}
        height={150}
        alt=""
        style={{ borderRadius: 33 }}
      />
      <div style={{ marginTop: 44, fontSize: 68, letterSpacing: -1 }}>
        You’ve been sent a gift
      </div>
      <div
        style={{
          marginTop: 26,
          display: "flex",
          fontSize: 34,
          fontWeight: 700,
        }}
      >
        <span style={{ color: TEXT }}>Send</span>
        <span style={{ color: AMBER }}>Ebun</span>
      </div>
    </div>,
    size,
  );
}
