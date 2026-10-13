import Link from "next/link";

/**
 * The handful of pieces every /ops page is built from, so pages look like
 * one tool rather than eight. Server-safe (no hooks): import anywhere.
 */

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">{title}</h1>
        {description && <p className="mt-1 text-zinc-600">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function ButtonLink({
  href,
  children,
  variant = "primary",
}: {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "secondary";
}) {
  return (
    <Link
      href={href}
      className={
        variant === "primary"
          ? "inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3.5 py-2 font-medium text-white shadow-sm hover:bg-zinc-800"
          : "inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3.5 py-2 font-medium text-zinc-800 shadow-sm hover:bg-zinc-50"
      }
    >
      {children}
    </Link>
  );
}

export function Card({
  title,
  action,
  children,
  className = "",
  flush = false,
}: {
  title?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** No inner padding — for tables and lists that run edge to edge. */
  flush?: boolean;
}) {
  return (
    <section className={`overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm ${className}`}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-zinc-100 px-5 py-3.5">
          <h2 className="font-semibold text-zinc-900">{title}</h2>
          {action}
        </header>
      )}
      <div className={flush ? "" : "p-5"}>{children}</div>
    </section>
  );
}

export function StatCard({
  label,
  value,
  hint,
  href,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  href?: string;
  tone?: "default" | "attention";
}) {
  const body = (
    <div
      className={`h-full rounded-xl border bg-white p-4 shadow-sm transition-colors ${
        tone === "attention" ? "border-amber-300" : "border-zinc-200"
      } ${href ? "hover:border-zinc-400" : ""}`}
    >
      <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tracking-tight text-zinc-900 tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

const PILL_TONES = {
  green: "bg-emerald-50 text-emerald-800 ring-emerald-600/20",
  grey: "bg-zinc-100 text-zinc-700 ring-zinc-500/20",
  amber: "bg-amber-50 text-amber-900 ring-amber-600/25",
  red: "bg-red-50 text-red-800 ring-red-600/20",
  blue: "bg-sky-50 text-sky-800 ring-sky-600/20",
} as const;

export function Pill({
  tone = "grey",
  children,
}: {
  tone?: keyof typeof PILL_TONES;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${PILL_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-12 text-center">
      <p className="font-medium text-zinc-900">{title}</p>
      {body && <p className="mx-auto mt-1 max-w-md text-zinc-600">{body}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/** "12 min ago", "3 h ago", "2 days ago". For waits and activity, where the gap matters more than the clock. */
export function timeAgo(iso: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} days ago`;
}
