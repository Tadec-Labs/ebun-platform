"use client";

import { useEffect, useRef, useState } from "react";
import type { RevealMessage } from "@/lib/reveal/types";
import { PauseIcon, PlayIcon } from "@/components/icons";

// A drawn shape, not an amplitude trace: it reads as "voice note" and
// fills with gold as the message plays. Fixed so it never reflows.
const WAVEFORM_BARS = [5, 11, 7, 16, 10, 20, 8, 14, 6, 12, 9, 18, 7, 11, 15, 6, 13, 9, 17, 8];

function formatDuration(totalSecs: number): string {
  const safe = Number.isFinite(totalSecs) && totalSecs > 0 ? totalSecs : 0;
  const m = Math.floor(safe / 60);
  const s = Math.floor(safe % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface MessagePlayerProps {
  message: RevealMessage;
  senderName?: string | null;
}

/**
 * The sender's message: text, or their actual voice or face.
 *
 * Recordings play from a short-lived private link the API signs on each
 * page load. Length comes from the sender's phone (messageDurationSecs)
 * rather than the file: WebM from Chrome's recorder often reports no
 * duration at all, which would leave the timer at "Infinity".
 */
export function MessagePlayer({ message, senderName }: MessagePlayerProps) {
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

  const label =
    message.type === "video"
      ? `A video from ${senderName ?? "them"}`
      : `A voice note from ${senderName ?? "them"}`;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] tracking-wide" style={{ color: "var(--gold-dim)" }}>
        {label}
      </p>
      {!message.playbackUrl ? (
        <Unavailable />
      ) : message.type === "video" ? (
        <VideoMessage url={message.playbackUrl} />
      ) : (
        <VoiceMessage url={message.playbackUrl} durationSecs={message.durationSecs ?? 0} />
      )}
      {message.text && (
        <p className="font-display text-lg italic leading-snug" style={{ color: "var(--cream)" }}>
          &ldquo;{message.text}&rdquo;
        </p>
      )}
    </div>
  );
}

function Unavailable() {
  return (
    <p className="border px-4 py-3 text-sm" style={{ borderColor: "var(--border)", color: "var(--cream-dim)" }}>
      Their recording can&rsquo;t be played just now. Reload this page in a moment.
    </p>
  );
}

function CantPlay({ url }: { url: string }) {
  return (
    <p className="text-xs leading-relaxed" style={{ color: "var(--cream-dim)" }}>
      This phone couldn&rsquo;t play it here.{" "}
      <a href={url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
        Open the recording
      </a>
      .
    </p>
  );
}

function VideoMessage({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <video
        src={url}
        controls
        playsInline
        preload="metadata"
        onError={() => setFailed(true)}
        className="aspect-square w-full border object-cover"
        style={{ borderColor: "var(--border)", background: "var(--panel-raised)" }}
      />
      {failed && <CantPlay url={url} />}
    </div>
  );
}

function VoiceMessage({ url, durationSecs }: { url: string; durationSecs: number }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [failed, setFailed] = useState(false);
  const [fileDuration, setFileDuration] = useState(0);

  // Pause if the recipient navigates away mid-message.
  useEffect(() => {
    const audio = audioRef.current;
    return () => audio?.pause();
  }, []);

  const total = durationSecs > 0 ? durationSecs : fileDuration;
  const progressPct = total > 0 ? Math.min(elapsed / total, 1) : 0;

  async function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      return;
    }
    try {
      await audio.play();
    } catch {
      setFailed(true);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setElapsed(0);
        }}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d)) setFileDuration(d);
        }}
        onTimeUpdate={(e) => setElapsed(e.currentTarget.currentTime)}
        onError={() => setFailed(true)}
      />
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => void toggle()}
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
        <div className="flex h-8 flex-1 items-center gap-[3px]" aria-hidden>
          {WAVEFORM_BARS.map((h, i) => {
            const played = (i + 1) / WAVEFORM_BARS.length <= progressPct;
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
          {formatDuration(playing || elapsed > 0 ? total - elapsed : total)}
        </span>
      </div>
      {failed && <CantPlay url={url} />}
    </div>
  );
}
