import Image from "next/image";
import Link from "next/link";

/**
 * The SendEbun logo, as the brand kit specifies it for dark surfaces:
 * the original symbol on its own light tile, beside a text wordmark —
 * "Send" in ivory, "Ebun" in amber.
 *
 * The symbol is a crop of the supplied artwork, not a redraw or a
 * recolour. The artwork's dark-green lettering is never placed on the
 * forest background (it disappears there), which is why the wordmark is
 * set in type rather than cut from the image.
 *
 * Colours fall back to literal brand hex because "/" renders outside the
 * consumer theme, where the token variables aren't loaded.
 */
export function BrandLogo({
  size = "md",
  wordmark = true,
  href = "/send",
}: {
  size?: "sm" | "md";
  wordmark?: boolean;
  /** Where the logo goes when tapped; null for a plain, unlinked logo. */
  href?: string | null;
}) {
  const tile = size === "sm" ? 28 : 36;
  const content = (
    <span className="inline-flex items-center gap-2.5">
      <Image
        src="/brand/sendebun-symbol.png"
        alt={wordmark ? "" : "SendEbun"}
        width={tile}
        height={tile}
        priority
        className="shrink-0 rounded-[22%]"
      />
      {wordmark && (
        <span
          className={`font-bold tracking-tight ${size === "sm" ? "text-lg" : "text-xl"}`}
          style={{ fontFamily: "var(--font-dm-sans), system-ui, sans-serif" }}
        >
          <span style={{ color: "var(--sendebun-text, #F5F1E7)" }}>Send</span>
          <span style={{ color: "var(--sendebun-amber, #FFAE00)" }}>Ebun</span>
        </span>
      )}
    </span>
  );

  if (!href) return content;
  return (
    <Link
      href={href}
      aria-label="SendEbun — send a gift"
      className="inline-flex"
    >
      {content}
    </Link>
  );
}
