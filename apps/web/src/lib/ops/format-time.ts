/**
 * Lagos time, explicitly, everywhere in /ops.
 *
 * The API returns UTC and Vercel's servers run in whatever region they
 * feel like, so neither end can be trusted to default correctly.
 * Rendering "9:40pm" for an order placed at 10:40pm WAT would make the
 * audit timeline lie, which is the one thing an ops tool cannot do.
 */
const WAT = "Africa/Lagos";

/** "09 Oct 22:40" — dense, for table cells. */
export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-NG", {
    timeZone: WAT,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** "09 Oct 2026, 22:40:13" — for a timeline, where seconds matter. */
export function formatWhenPrecise(iso: string): string {
  return new Date(iso).toLocaleString("en-NG", {
    timeZone: WAT,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/** "4 minutes ago" / "in 29 days". Relative to now, rounded coarsely. */
export function formatRelative(iso: string, now = Date.now()): string {
  const deltaSecs = Math.round((new Date(iso).getTime() - now) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["second", 60],
    ["minute", 60],
    ["hour", 24],
    ["day", 30],
    ["month", 12],
    ["year", Number.POSITIVE_INFINITY],
  ];

  let value = deltaSecs;
  for (const [unit, size] of units) {
    if (Math.abs(value) < size || unit === "year") {
      return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(
        Math.round(value),
        unit,
      );
    }
    value = value / size;
  }
  return new Date(iso).toISOString();
}
