"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface HoldToUnwrapProps {
  onUnwrapped: () => void;
  holdMs?: number;
  label?: string;
  fallbackLabel?: string;
}

/**
 * The arrival-triggered second reveal for physical gifts. Deliberately a
 * different gesture from the scratch card (press-and-hold a seal,
 * rather than scratch foil) — by this point the recipient has the
 * actual parcel in hand, so "unwrapping" reads truer than "scratching"
 * a second time would.
 *
 * Press-and-hold has no faithful keyboard equivalent, so Enter/Space
 * trigger it immediately rather than requiring a timed hold — an
 * accessible equivalent action, not a degraded version of the same one.
 * A visible text fallback covers pointer users who'd rather not hold.
 */
export function HoldToUnwrap({
  onUnwrapped,
  holdMs = 1300,
  label = "Press and hold to open",
  fallbackLabel = "Open your message",
}: HoldToUnwrapProps) {
  const [progress, setProgress] = useState(0);
  const [unwrapped, setUnwrapped] = useState(false);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    startRef.current = null;
    setProgress(0);
  }, []);

  const complete = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    setProgress(1);
    setUnwrapped(true);
    window.setTimeout(onUnwrapped, 260);
  }, [onUnwrapped]);

  // Held in a ref rather than a plain useCallback: the frame callback
  // recurses on itself (rAF-driven loop), and referencing a useCallback
  // binding from inside its own initializer trips
  // react-hooks/immutability (the binding isn't guaranteed updated yet
  // at that point). Routing the recursive call through a ref sidesteps
  // that — `tickRef.current` is always a valid reference by the time
  // it's invoked, regardless of when it was last reassigned.
  const tickRef = useRef<(timestamp: number) => void>(() => {});

  useEffect(() => {
    tickRef.current = (timestamp: number) => {
      if (startRef.current === null) startRef.current = timestamp;
      const elapsed = timestamp - startRef.current;
      const pct = Math.min(elapsed / holdMs, 1);
      setProgress(pct);
      if (pct >= 1) {
        complete();
        return;
      }
      rafRef.current = requestAnimationFrame(tickRef.current);
    };
  }, [complete, holdMs]);

  const start = useCallback(() => {
    if (unwrapped) return;
    startRef.current = null;
    rafRef.current = requestAnimationFrame(tickRef.current);
  }, [unwrapped]);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const angle = progress * 360;

  return (
    <div className="flex flex-col items-center gap-5">
      <button
        type="button"
        aria-label={label}
        onPointerDown={start}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            complete();
          }
        }}
        className="relative flex h-24 w-24 select-none items-center justify-center rounded-full outline-none"
        style={{
          background: `conic-gradient(var(--gold) ${angle}deg, transparent ${angle}deg)`,
          transform: unwrapped ? "scale(1.08)" : "scale(1)",
          opacity: unwrapped ? 0 : 1,
          transition: unwrapped
            ? "opacity 260ms ease-out, transform 260ms ease-out"
            : "transform 150ms ease-out",
        }}
      >
        <span
          className="flex h-[76px] w-[76px] items-center justify-center rounded-full border"
          style={{ borderColor: "var(--gold-dim)", background: "var(--panel)" }}
        >
          <svg
            viewBox="0 0 24 24"
            className="h-7 w-7"
            fill="none"
            stroke="var(--gold)"
            strokeWidth={1.3}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M4 6h16v12H4z" />
            <path d="M4 7l8 6 8-6" />
          </svg>
        </span>
      </button>
      <p className="text-[11px] tracking-wide" style={{ color: "var(--cream-dim)" }}>
        {label}
      </p>
      <button
        type="button"
        onClick={complete}
        className="text-[11px] tracking-wide underline underline-offset-4"
        style={{ color: "var(--cream-dim)", textDecorationColor: "var(--gold-dim)" }}
      >
        {fallbackLabel}
      </button>
    </div>
  );
}
