import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { LEGAL } from "@/lib/legal";

/**
 * Shared frame for Terms, Privacy and Refunds.
 *
 * Written to be read, not just to exist: one column at a comfortable
 * measure, plain headings, short sections, the summary first. These
 * pages are linked from the pay button, so a sender deciding whether to
 * trust Ebun with their money may genuinely open one — it should look
 * like the same careful product, not a pasted document.
 */
export function LegalPage({
  title,
  summary,
  children,
}: {
  title: string;
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-[680px] px-7 pt-6 pb-16">
      <header className="flex items-center justify-between pb-10">
        <BrandLogo size="sm" />
        <LegalNav />
      </header>

      <h1
        className="font-display text-4xl leading-tight font-normal"
        style={{ color: "var(--cream)" }}
      >
        {title}
      </h1>
      <p className="mt-2 text-xs" style={{ color: "var(--cream-faint)" }}>
        Last updated {LEGAL.lastUpdated}
      </p>
      <p
        className="mt-6 border-l-2 py-1 pl-4 text-sm leading-relaxed"
        style={{ borderColor: "var(--gold-dim)", color: "var(--cream)" }}
      >
        {summary}
      </p>

      <div className="legal-body mt-10 flex flex-col gap-8 text-sm leading-relaxed">
        {children}
      </div>

      <footer
        className="mt-14 border-t pt-6 text-xs leading-relaxed"
        style={{ borderColor: "var(--border)", color: "var(--cream-dim)" }}
      >
        {LEGAL.brand} is operated by {LEGAL.entity}, {LEGAL.entityDescription}.{" "}
        {LEGAL.address}. Questions:{" "}
        <a href={`mailto:${LEGAL.email}`} className="underline">
          {LEGAL.email}
        </a>{" "}
        · {LEGAL.phone}
      </footer>
    </div>
  );
}

export function Section({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2
        className="font-display text-2xl font-normal"
        style={{ color: "var(--cream)" }}
      >
        {heading}
      </h2>
      <div
        className="flex flex-col gap-3"
        style={{ color: "var(--cream-dim)" }}
      >
        {children}
      </div>
    </section>
  );
}

export function List({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="flex list-disc flex-col gap-1.5 pl-5 marker:text-[color:var(--gold-dim)]">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

function LegalNav() {
  const link = "text-xs underline-offset-4 hover:underline";
  return (
    <nav
      className="flex gap-4"
      aria-label="Policies"
      style={{ color: "var(--cream-dim)" }}
    >
      <Link href="/terms" className={link}>
        Terms
      </Link>
      <Link href="/privacy" className={link}>
        Privacy
      </Link>
      <Link href="/refunds" className={link}>
        Refunds
      </Link>
    </nav>
  );
}
