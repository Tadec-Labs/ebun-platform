"use client";

import { useEffect, useState } from "react";
import type { GroupGift } from "@/lib/reveal/types";

const STEP_MS = 900;

/**
 * Everyone who chipped in, and what they said — the part of a group gift
 * that a pile of transfers can never be. The lines arrive one at a time,
 * like people stepping forward, rather than as a list to scan. Names
 * without a line close it: everyone who paid is on the gift.
 *
 * With reduced motion, everything shows at once.
 */
export function GroupLines({ group }: { group: GroupGift }) {
  const withLines = group.contributors.filter((c) => c.message);
  const nameOnly = group.contributors.filter((c) => !c.message);
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (shown > withLines.length) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = setTimeout(
      () => setShown((n) => (reduced ? withLines.length + 1 : n + 1)),
      reduced ? 0 : shown === 0 ? 400 : STEP_MS,
    );
    return () => clearTimeout(timer);
  }, [shown, withLines.length]);

  if (group.contributors.length === 0) return null;

  return (
    <section className="flex flex-col gap-4" aria-label="From everyone who chipped in">
      <p className="text-[11px] tracking-wide" style={{ color: "var(--gold-dim)" }}>
        {group.contributorCount === 1
          ? "Chipped in by one friend"
          : `Chipped in by ${group.contributorCount} people`}
      </p>
      <ul className="flex flex-col gap-3">
        {withLines.map((c, i) => (
          <li
            key={`${c.name}-${i}`}
            className="border-l-2 pl-3 transition-all duration-500"
            style={{
              borderColor: "var(--gold)",
              opacity: i < shown ? 1 : 0,
              transform: i < shown ? "none" : "translateY(6px)",
            }}
          >
            <p className="font-display text-lg italic leading-snug" style={{ color: "var(--cream)" }}>
              &ldquo;{c.message}&rdquo;
            </p>
            <p className="mt-0.5 text-xs" style={{ color: "var(--gold-light)" }}>
              {c.name}
            </p>
          </li>
        ))}
      </ul>
      {nameOnly.length > 0 && (
        <p
          className="text-xs leading-relaxed transition-opacity duration-500"
          style={{ color: "var(--cream-dim)", opacity: shown > withLines.length - 1 ? 1 : 0 }}
        >
          {withLines.length > 0 ? "And from " : "From "}
          {joinNames(nameOnly.map((c) => c.name))}.
        </p>
      )}
    </section>
  );
}

function joinNames(names: string[]): string {
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
