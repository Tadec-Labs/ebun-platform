import QRCode from "qrcode";

/**
 * SERVER ONLY. Every caller is a server component or a "use server"
 * action, which keeps the encoder out of the browser bundle entirely —
 * the page ships a finished <svg>, not a library.
 *
 * Why a dependency at all: a QR encoder is Reed-Solomon error
 * correction, bit interleaving and mask-pattern selection. It is not
 * the kind of thing worth hand-rolling, and a subtly wrong one produces
 * codes that scan on the phone you tested with and fail at a counter.
 *
 * What goes in is the redemption_token itself, never a URL containing
 * it — the schema is explicit that this token "is never in a URL. It is
 * the QR code payload", because a URL ends up in browser history and
 * every proxy log along the way, and possessing this token is what
 * claims the gift.
 */
export async function renderQrSvg(payload: string): Promise<string | null> {
  try {
    return await QRCode.toString(payload, {
      type: "svg",
      // 'M' tolerates ~15% damage — the realistic failure here is glare
      // and a smudged phone screen at a counter, not a torn label.
      errorCorrectionLevel: "M",
      margin: 1,
      // Rendered as a viewBox'd SVG, so this is only the intrinsic size;
      // CSS decides what it actually occupies on screen.
      width: 320,
      color: { dark: "#0e0d0b", light: "#f5efe0" },
    });
  } catch {
    // A QR that won't render must not take the whole screen down with
    // it — the fallback code underneath is always shown and is enough
    // to collect the gift on its own.
    return null;
  }
}
