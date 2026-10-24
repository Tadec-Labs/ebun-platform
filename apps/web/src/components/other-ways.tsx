import Link from "next/link";
import { becomePartnerUrl, helpUrl } from "@/lib/site-links";

/**
 * The bottom of the gift list: the other things people come to SendEbun
 * for, one line each. Below the gifts, never above them — someone here
 * to send a gift should see gifts first and never have to read past this.
 */
export function OtherWays({ companiesOpen }: { companiesOpen: boolean }) {
  const row = "flex items-center justify-between gap-3 border-t py-3.5 text-sm";
  const arrow = (
    <span aria-hidden="true" style={{ color: "var(--gold-light)" }}>
      →
    </span>
  );
  return (
    <nav aria-label="More ways to use SendEbun" className="mt-10 flex flex-col">
      <p className="pb-2 text-[11px] tracking-[0.14em] uppercase" style={{ color: "var(--gold-dim)" }}>
        More ways to use SendEbun
      </p>
      {companiesOpen && (
        <Link href="/company/start" className={row} style={{ borderColor: "var(--border)", color: "var(--cream)" }}>
          <span>
            Gifts for your team or clients
            <span className="block text-xs" style={{ color: "var(--cream-dim)" }}>
              One list, one message, everyone chooses
            </span>
          </span>
          {arrow}
        </Link>
      )}
      <a
        href={becomePartnerUrl()}
        target="_blank"
        rel="noopener noreferrer"
        className={row}
        style={{ borderColor: "var(--border)", color: "var(--cream)" }}
      >
        <span>
          Run a restaurant, bakery, spa or cinema?
          <span className="block text-xs" style={{ color: "var(--cream-dim)" }}>
            Become a SendEbun partner — free to join
          </span>
        </span>
        {arrow}
      </a>
      <a
        href={helpUrl()}
        target="_blank"
        rel="noopener noreferrer"
        className={`${row} border-b`}
        style={{ borderColor: "var(--border)", color: "var(--cream)" }}
      >
        <span>
          Need a hand choosing?
          <span className="block text-xs" style={{ color: "var(--cream-dim)" }}>
            Chat with us on WhatsApp
          </span>
        </span>
        {arrow}
      </a>
    </nav>
  );
}
