"use client";

import { useEffect, useRef, useState } from "react";
import { PauseIcon, PlayIcon } from "@/components/icons";
import {
  type RecordedMedia,
  type RecorderKind,
  useMediaRecorder,
} from "@/lib/media-recording/use-media-recorder";

function formatDuration(totalSecs: number): string {
  const m = Math.floor(totalSecs / 60);
  const s = Math.floor(totalSecs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function MediaRecorderPanel({
  kind,
  maxDurationSecs,
  initial,
  onRecorded,
  onCleared,
}: {
  kind: RecorderKind;
  maxDurationSecs: number;
  initial: RecordedMedia | null;
  onRecorded: (media: RecordedMedia) => void;
  onCleared: () => void;
}) {
  const { status, elapsedSecs, recorded, stream, start, stop, reset } = useMediaRecorder({
    kind,
    maxDurationSecs,
    initial,
  });

  // Lift a completed recording up to the wizard's draft state the
  // moment it's ready — this hook's own `recorded` is the source of
  // truth while on this screen, but the parent needs a copy to survive
  // switching message types and coming back.
  const liftedRef = useRef<RecordedMedia | null>(initial ?? null);
  useEffect(() => {
    if (recorded && recorded !== liftedRef.current) {
      liftedRef.current = recorded;
      onRecorded(recorded);
    }
  }, [recorded, onRecorded]);

  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (videoPreviewRef.current) videoPreviewRef.current.srcObject = stream;
  }, [stream]);

  const noun = kind === "video" ? "video" : "voice note";

  if (status === "unsupported") {
    return (
      <PanelMessage>
        Recording isn&rsquo;t supported in this browser. Text still works below.
      </PanelMessage>
    );
  }

  if (status === "permission-denied") {
    return (
      <PanelMessage>
        Camera/microphone access was denied or unavailable.{" "}
        <button type="button" onClick={() => void start()} className="underline" style={{ color: "var(--gold-light)" }}>
          Try again
        </button>{" "}
        — or use text below.
      </PanelMessage>
    );
  }

  if (status === "idle" || status === "requesting-permission") {
    return (
      <div
        className="flex flex-col items-center justify-center gap-3 border py-10"
        style={{ borderColor: "var(--border)" }}
      >
        <button
          type="button"
          onClick={() => void start()}
          disabled={status === "requesting-permission"}
          aria-label={`Record a ${noun}`}
          className="flex h-14 w-14 items-center justify-center rounded-full"
          style={{ background: "var(--gold)", color: "var(--ink)" }}
        >
          <span className="h-4 w-4 rounded-full" style={{ background: "var(--ink)" }} />
        </button>
        <p className="text-xs" style={{ color: "var(--cream-dim)" }}>
          {status === "requesting-permission"
            ? "Requesting access…"
            : `Tap to record — up to ${maxDurationSecs}s`}
        </p>
      </div>
    );
  }

  if (status === "recording") {
    return (
      <div className="flex flex-col gap-3 border p-4" style={{ borderColor: "var(--gold)" }}>
        {kind === "video" && (
          <video
            ref={videoPreviewRef}
            autoPlay
            muted
            playsInline
            className="w-full"
            style={{ transform: "scaleX(-1)", background: "var(--panel-raised)" }}
          />
        )}
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-xs" style={{ color: "var(--gold-light)" }}>
            <span className="h-2 w-2 animate-pulse rounded-full" style={{ background: "#c94c4c" }} />
            {formatDuration(elapsedSecs)} / {formatDuration(maxDurationSecs)}
          </span>
          <button
            type="button"
            onClick={stop}
            className="px-4 py-2 text-xs tracking-wide"
            style={{ background: "var(--gold)", color: "var(--ink)" }}
          >
            Stop
          </button>
        </div>
      </div>
    );
  }

  // status === "recorded"
  if (!recorded) return null;

  return (
    <div className="flex flex-col gap-3">
      {kind === "video" ? (
        <video
          controls
          playsInline
          src={recorded.url}
          className="w-full border"
          style={{ borderColor: "var(--border)" }}
        />
      ) : (
        <RecordedAudioPlayer media={recorded} />
      )}
      <button
        type="button"
        onClick={() => {
          reset();
          onCleared();
        }}
        className="self-start text-[11px] tracking-wide underline underline-offset-4"
        style={{ color: "var(--cream-dim)", textDecorationColor: "var(--gold-dim)" }}
      >
        Re-record
      </button>
    </div>
  );
}

function PanelMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="border p-4 text-xs leading-relaxed" style={{ borderColor: "var(--border)", color: "var(--cream-dim)" }}>
      {children}
    </div>
  );
}

/** Real playback of a real recorded Blob — an actual <audio> element, unlike reveal's MessagePlayer (which fakes elapsed time because it has no real media source yet). */
function RecordedAudioPlayer({ media }: { media: RecordedMedia }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  return (
    <div className="flex items-center gap-4 border p-4" style={{ borderColor: "var(--border)" }}>
      <audio
        ref={audioRef}
        src={media.url}
        onTimeUpdate={(e) => setElapsed(e.currentTarget.currentTime)}
        onEnded={() => {
          setPlaying(false);
          setElapsed(0);
        }}
        className="hidden"
      />
      <button
        type="button"
        onClick={() => {
          if (!audioRef.current) return;
          if (playing) {
            audioRef.current.pause();
          } else {
            void audioRef.current.play();
          }
          setPlaying(!playing);
        }}
        aria-label={playing ? "Pause" : "Play"}
        className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full"
        style={{ background: "var(--gold)" }}
      >
        {playing ? (
          <PauseIcon className="h-4 w-4 text-[color:var(--ink)]" />
        ) : (
          <PlayIcon className="ml-0.5 h-4 w-4 text-[color:var(--ink)]" />
        )}
      </button>
      <span className="text-xs" style={{ color: "var(--cream-dim)" }}>
        {formatDuration(elapsed)} / {formatDuration(media.durationSecs)}
      </span>
    </div>
  );
}
