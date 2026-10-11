import Link from "next/link";

/**
 * The one-line footer used across the send flow, confirmation and
 * reveal screens. Small on purpose: present everywhere a customer might
 * look for it, never competing with the screen's actual job.
 */
export function PolicyLinks({ className = "" }: { className?: string }) {
  const link = "underline-offset-4 hover:underline";
  return (
    <p
      className={`text-center text-[11px] ${className}`}
      style={{ color: "var(--cream-faint)" }}
    >
      <Link href="/terms" className={link}>
        Terms
      </Link>{" "}
      ·{" "}
      <Link href="/privacy" className={link}>
        Privacy
      </Link>{" "}
      ·{" "}
      <Link href="/refunds" className={link}>
        Refunds
      </Link>
    </p>
  );
}
