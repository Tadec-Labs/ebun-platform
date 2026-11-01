"use client";

import { useEffect, useRef, useState } from "react";
import { getWall } from "@/lib/events/api";
import type { EventCopy } from "@/lib/events/copy";
import type { WallEntry } from "@/lib/events/types";
import { formatNaira } from "@/lib/format-money";

const POLL_MS = 3_000;
const SPOTLIGHT_MS = 6_000;

/**
 * The live screen: the newest gift in the spotlight, the last few down
 * the side, and the QR code to give. New arrivals jump the queue; with
 * nothing new it slowly cycles through recent givers so the screen is
 * never static. If the feed can't be reached it keeps what it has.
 */
export function SprayWall({
  slug,
  title,
  copy,
  guestPath,
  qrSvg,
  cashOpen,
}: {
  slug: string;
  title: string;
  copy: EventCopy;
  guestPath: string;
  qrSvg: string | null;
  cashOpen: boolean;
}) {
  const [entries, setEntries] = useState<WallEntry[]>([]);
  const [spotlight, setSpotlight] = useState<WallEntry | null>(null);
  const seen = useRef<Set<string>>(new Set());
  const queue = useRef<WallEntry[]>([]);
  const cursor = useRef(0);
  const latest = useRef<WallEntry[]>([]);

  // Poll the feed. Anything not seen before goes to the front of the queue.
  useEffect(() => {
    let stopped = false;
    async function load() {
      const next = await getWall(slug);
      if (stopped || !next) return;
      const fresh = next.filter((e) => !seen.current.has(e.id));
      const firstLoad = seen.current.size === 0;
      fresh.forEach((e) => seen.current.add(e.id));
      // On first load, don't replay history as "new": just start cycling.
      if (!firstLoad) queue.current.push(...fresh.reverse());
      latest.current = next;
      setEntries(next);
    }
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [slug]);

  // The spotlight: new arrivals first, otherwise cycle through the recent ones.
  useEffect(() => {
    function advance() {
      const fromQueue = queue.current.shift();
      if (fromQueue) {
        setSpotlight(fromQueue);
        return;
      }
      const current = latest.current;
      if (current.length > 0) {
        cursor.current = (cursor.current + 1) % Math.min(current.length, 12);
        setSpotlight(current[cursor.current]);
      }
    }
    advance();
    const timer = setInterval(advance, SPOTLIGHT_MS);
    return () => clearInterval(timer);
  }, []);

  const current = spotlight ?? entries[0] ?? null;
  const side = entries.filter((e) => e.id !== current?.id).slice(0, 6);
  const count = entries.length;

  return (
    <div
      className="grid h-dvh w-full gap-[4vw] overflow-hidden px-[5vw] py-[5vh]"
      style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 28vw)", background: "var(--deep)" }}
    >
      <style>{`@keyframes ebunWallRise{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:none}}`}</style>

      <div className="flex min-w-0 flex-col justify-between">
        <div className="flex items-baseline gap-5">
          <p className="font-display text-[3.2vw] leading-none" style={{ color: "var(--cream)" }}>
            {title}
          </p>
          <p className="text-[1.3vw]" style={{ color: "var(--cream-dim)" }}>
            {copy.wall}
          </p>
        </div>

        {current ? (
          <div key={current.id} className="flex flex-col gap-[2vh]" style={{ animation: "ebunWallRise 700ms ease-out" }}>
            <p className="text-[1.3vw] tracking-[0.2em] uppercase" style={{ color: "var(--gold)" }}>
              {current.kind === "gift" && current.giftName ? `gave ${current.giftName}` : copy.wallVerb}
              {current.amount !== null ? ` · ${formatNaira(current.amount)}` : ""}
            </p>
            <p className="font-display text-[8vw] leading-[0.95]" style={{ color: "var(--gold-light)" }}>
              {current.name}
            </p>
            {current.message && (
              <p className="font-display max-w-[52vw] text-[2.6vw] leading-snug italic" style={{ color: "var(--gold-champagne, #F3E2BC)" }}>
                &ldquo;{current.message}&rdquo;
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-[2vh]">
            <p className="font-display text-[5vw] leading-tight" style={{ color: "var(--gold-light)" }}>
              Be the first.
            </p>
          </div>
        )}

        <div className="flex items-center gap-[2vw]">
          {qrSvg && (
            <div
              className="aspect-square w-[9vw] min-w-24 overflow-hidden rounded-xl [&_svg]:block [&_svg]:h-full [&_svg]:w-full"
              aria-label={`QR code for ${guestPath}`}
              role="img"
              // Server-rendered by the qrcode library from our own URL; no user input.
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
          )}
          <div className="flex flex-col gap-1">
            <p className="text-[1.9vw] font-medium" style={{ color: "var(--cream)" }}>
              {cashOpen ? `Scan to ${copy.cash.toLowerCase()}` : "Scan to give"}
            </p>
            <p className="text-[1.2vw]" style={{ color: "var(--cream-dim)" }}>
              {guestPath}
            </p>
          </div>
          <p className="ml-auto text-[1.5vw] font-bold tracking-tight">
            <span style={{ color: "var(--cream)" }}>Send</span>
            <span style={{ color: "var(--action)" }}>Ebun</span>
          </p>
        </div>
      </div>

      <div className="flex min-h-0 flex-col gap-[1.4vh] border-l pl-[2.5vw]" style={{ borderColor: "var(--border)" }}>
        <p className="text-[1.1vw] tracking-[0.16em] uppercase" style={{ color: "var(--cream-dim)" }}>
          {count > 0 ? "Just now" : ""}
        </p>
        <ul className="flex flex-col">
          {side.map((e, i) => (
            <li
              key={e.id}
              className="flex flex-col gap-0.5 border-b py-[1.4vh]"
              style={{ borderColor: "var(--border)", opacity: 1 - i * 0.12 }}
            >
              <span className="text-[1.6vw] font-medium" style={{ color: "var(--cream)" }}>
                {e.name}
              </span>
              <span className="text-[1vw]" style={{ color: "var(--cream-dim)" }}>
                {e.kind === "gift" && e.giftName ? `gave ${e.giftName}` : copy.wallVerb}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
