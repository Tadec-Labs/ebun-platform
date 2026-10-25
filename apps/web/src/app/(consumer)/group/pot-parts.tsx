import { GiftMark } from "@/components/icons";
import { formatNaira } from "@/lib/format-money";
import type { GroupGiftSummary } from "@/lib/group/types";

/**
 * Pieces shared by the pot page and the organiser page. No state and no
 * hooks, so both server and client components can use them.
 */

export function GiftCard({ gift, caption }: { gift: GroupGiftSummary; caption?: string }) {
  return (
    <div className="flex items-center gap-4 border p-3" style={{ borderColor: "var(--border)", background: "var(--panel)" }}>
      <div
        className="flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden"
        style={{ background: "var(--panel-raised)" }}
      >
        {gift.imageUrl ? (
          // Partner photos come from the public R2 bucket at any size; a
          // plain img keeps them out of the image optimiser's domain list.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={gift.imageUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <GiftMark className="h-7 w-7 text-[color:var(--gold-dim)]" />
        )}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm" style={{ color: "var(--cream)" }}>
          {gift.name}
        </p>
        {caption && (
          <p className="mt-0.5 text-xs" style={{ color: "var(--gold-light)" }}>
            {caption}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The bar is the page's whole argument: how close the gift is. Raised
 * in display type, the rest small. A pot that's funded shows full, in
 * the success colour, so the screenshot people share is the good news.
 */
export function PotProgress({
  raised,
  target,
  contributorCount,
  funded,
}: {
  raised: number;
  target: number;
  contributorCount: number;
  funded: boolean;
}) {
  const percent = target > 0 ? Math.min(100, Math.round((raised / target) * 100)) : 0;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-display text-4xl leading-none" style={{ color: "var(--gold-light)" }}>
          {formatNaira(raised)}
        </p>
        <p className="text-xs" style={{ color: "var(--cream-dim)" }}>
          of {formatNaira(target)}
        </p>
      </div>
      <div
        className="h-2 w-full overflow-hidden"
        style={{ background: "var(--panel-raised)" }}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={`${percent}% of the gift paid for`}
      >
        <div
          className="h-full transition-[width] duration-700"
          style={{ width: `${percent}%`, background: funded ? "var(--success)" : "var(--gold)" }}
        />
      </div>
      <p className="text-xs" style={{ color: "var(--cream-dim)" }}>
        {contributorCount === 0
          ? "Be the first to chip in."
          : `${contributorCount} ${contributorCount === 1 ? "person has" : "people have"} chipped in · ${percent}%`}
      </p>
    </div>
  );
}

/** "Closes in 2 days", "Closes today at 6:00 pm", "Closed". */
export function deadlineLabel(deadline: string, now: number = Date.now()): string {
  const at = new Date(deadline).getTime();
  const left = at - now;
  if (left <= 0) return "The deadline has passed";
  const hours = left / 3_600_000;
  if (hours < 24) {
    const time = new Date(deadline).toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit" });
    return hours < 1 ? "Closes within the hour" : `Closes today at ${time}`;
  }
  const days = Math.round(hours / 24);
  return `Closes in ${days} ${days === 1 ? "day" : "days"}`;
}

/** First names joined the way people say them: "Bisi, Chidi and 3 others". */
export function namesLine(names: string[], max = 3): string {
  if (names.length === 0) return "";
  if (names.length <= max) {
    return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  }
  const rest = names.length - max;
  return `${names.slice(0, max).join(", ")} and ${rest} ${rest === 1 ? "other" : "others"}`;
}
