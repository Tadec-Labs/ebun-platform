"use client";

import { useEffect, useRef, useState } from "react";
import type { RevealMessage } from "@/lib/reveal/types";
import { PauseIcon, PlayIcon } from "@/components/icons";

// Fixed rather than randomised so the waveform doesn't reflow on every
// render — this is a mock shape, not a real amplitude trace. Real
// waveform data (or a generated one from the uploaded R2 asset) is
// backend/media-pipeline work, not part of this slice.
const WAVEFORM_BARS = [5, 11, 7, 16, 10, 20, 8, 14, 6, 12, 9, 18, 7, 11, 15, 6, 13, 9, 17, 8];

function formatDuration(totalSecs: number): string {
  const m = Math.floor(totalSecs / 60);
  const s = Math.floor(totalSecs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface MessagePlayerProps {
  message: RevealMessage;
  senderName?: string | null;
}

export function MessagePlayer({ message, senderName }: MessagePlayerProps) {
  const duration = message.durationSecs ?? 0;
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(false);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
    };
  }, []);

  // Mock playback clock — no real playbackUrl exists yet (see
  // get-reveal-view.ts), so this simulates elapsed time against the
  // message's stated duration rather than driving an <audio>/<video>
  // element. Swap this for real media once R2 playback URLs resolve.
  const toggle = () => {
    if (playing) {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
      setPlaying(false);
      return;
    }
    setPlaying(true);
    intervalRef.current = window.setInterval(() => {
      setElapsed((prev) => {
        const next = prev + 0.2;
        if (next >= duration) {
          if (intervalRef.current) window.clearInterval(intervalRef.current);
          setPlaying(false);
          return 0;
        }
        return next;
      });
    }, 200);
  };

  if (message.type === "text") {
    return (
      <div className="flex flex-col gap-2">
        {senderName && (
          <p className="text-[11px] tracking-wide" style={{ color: "var(--gold-dim)" }}>
            A note from {senderName}
          </p>
        )}
        <p className="font-display text-xl italic leading-snug" style={{ color: "var(--cream)" }}>
          &ldquo;{message.text}&rdquo;
        </p>
      </div>
    );
  }

  const progressPct = duration > 0 ? Math.min(elapsed / duration, 1) : 0;

  if (message.type === "video") {
    return (
      <div className="flex flex-col gap-2">
        {senderName && (
          <p className="text-[11px] tracking-wide" style={{ color: "var(--gold-dim)" }}>
            A video from {senderName}
          </p>
        )}
        <button
          type="button"
          onClick={toggle}
          className="relative flex h-40 w-full items-center justify-center overflow-hidden border"
          style={{ borderColor: "var(--border)", background: "var(--panel-raised)" }}
        >
          <span
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(ellipse 60% 60% at 50% 40%, var(--gold-glow), transparent 70%)",
            }}
          />
          <span
            className="relative flex h-12 w-12 items-center justify-center rounded-full"
            style={{ background: "var(--gold)" }}
          >
            {playing ? (
              <PauseIcon className="h-4 w-4 text-[color:var(--ink)]" />
            ) : (
              <PlayIcon className="h-4 w-4 text-[color:var(--ink)]" />
            )}
          </span>
          <span
            className="absolute bottom-2 right-3 text-[11px]"
            style={{ color: "var(--cream-dim)" }}
          >
            {formatDuration(duration - elapsed)}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {senderName && (
        <p className="text-[11px] tracking-wide" style={{ color: "var(--gold-dim)" }}>
          A voice note from {senderName}
        </p>
      )}
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? "Pause message" : "Play message"}
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full"
          style={{ background: "var(--gold)" }}
        >
          {playing ? (
            <PauseIcon className="h-4 w-4 text-[color:var(--ink)]" />
          ) : (
            <PlayIcon className="ml-0.5 h-4 w-4 text-[color:var(--ink)]" />
          )}
        </button>
        <div className="flex h-8 flex-1 items-center gap-[3px]">
          {WAVEFORM_BARS.map((h, i) => {
            const barPct = (i + 1) / WAVEFORM_BARS.length;
            const played = barPct <= progressPct;
            return (
              <span
                key={i}
                className="w-[3px] rounded-full transition-colors"
                style={{
                  height: `${h}px`,
                  background: played ? "var(--gold)" : "var(--gold-dim)",
                  opacity: played ? 1 : 0.5,
                }}
              />
            );
          })}
        </div>
        <span className="w-9 flex-shrink-0 text-right text-[11px]" style={{ color: "var(--cream-dim)" }}>
          {formatDuration(playing || elapsed > 0 ? duration - elapsed : duration)}
        </span>
      </div>
    </div>
  );
}
