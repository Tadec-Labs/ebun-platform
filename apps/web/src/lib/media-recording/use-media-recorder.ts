"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type RecorderKind = "audio" | "video";

export type RecorderStatus =
  | "idle"
  | "requesting-permission"
  | "recording"
  | "recorded"
  | "permission-denied"
  | "unsupported";

export interface RecordedMedia {
  blob: Blob;
  url: string;
  durationSecs: number;
}

interface UseMediaRecorderOptions {
  kind: RecorderKind;
  maxDurationSecs: number;
  /** Pre-populate the "recorded" state, e.g. returning to this screen after navigating away. */
  initial?: RecordedMedia | null;
}

function pickMimeType(kind: RecorderKind): string | undefined {
  const candidates =
    kind === "video"
      ? ["video/webm;codecs=vp9,opus", "video/webm", "video/mp4"]
      : ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];

  if (typeof MediaRecorder === "undefined") return undefined;
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

function isRecordingSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined"
  );
}

/**
 * Wraps MediaRecorder for a fixed-length voice or video note. Entirely
 * client-side — the output is a local Blob + object URL, nothing is
 * uploaded anywhere. Wiring that Blob to a real upload is separate,
 * R2-dependent work (see message-composer.tsx's comment on this).
 */
export function useMediaRecorder({ kind, maxDurationSecs, initial }: UseMediaRecorderOptions) {
  const [status, setStatus] = useState<RecorderStatus>(() =>
    initial ? "recorded" : isRecordingSupported() ? "idle" : "unsupported",
  );
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const [recorded, setRecorded] = useState<RecordedMedia | null>(initial ?? null);
  const [stream, setStream] = useState<MediaStream | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);
  const timerRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setStream(null);
  }, []);

  const stop = useCallback(() => {
    clearTimer();
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop(); // onstop handler (below) finishes the job
    }
  }, [clearTimer]);

  const start = useCallback(async () => {
    if (!isRecordingSupported()) {
      setStatus("unsupported");
      return;
    }

    setStatus("requesting-permission");
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: kind === "video" ? { facingMode: "user" } : false,
      });
      streamRef.current = mediaStream;
      setStream(mediaStream);

      chunksRef.current = [];
      const mimeType = pickMimeType(kind);
      const recorder = new MediaRecorder(
        mediaStream,
        mimeType ? { mimeType } : undefined,
      );
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: mimeType ?? (kind === "video" ? "video/webm" : "audio/webm"),
        });
        const url = URL.createObjectURL(blob);
        const durationSecs = Math.round((Date.now() - startedAtRef.current) / 1000);
        setRecorded({ blob, url, durationSecs });
        setStatus("recorded");
        releaseStream();
      };

      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      recorder.start();
      setStatus("recording");
      setElapsedSecs(0);

      timerRef.current = window.setInterval(() => {
        const secs = (Date.now() - startedAtRef.current) / 1000;
        setElapsedSecs(secs);
        if (secs >= maxDurationSecs) stop();
      }, 200);
    } catch {
      // Covers permission denial, no device present, and insecure-context
      // failures alike — MediaRecorder's error variety isn't worth
      // surfacing distinctly here; "text still works" is the actionable
      // message regardless of which one it was.
      setStatus("permission-denied");
      releaseStream();
    }
  }, [kind, maxDurationSecs, releaseStream, stop]);

  const reset = useCallback(() => {
    if (recorded) URL.revokeObjectURL(recorded.url);
    setRecorded(null);
    setElapsedSecs(0);
    setStatus(isRecordingSupported() ? "idle" : "unsupported");
  }, [recorded]);

  useEffect(() => {
    return () => {
      clearTimer();
      releaseStream();
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
      // Deliberately not revoking `recorded`'s object URL on unmount —
      // ownership of that Blob/URL passes to the caller via onRecorded,
      // and this hook doesn't know whether they still need it (e.g.
      // navigating between wizard phases and back).
    };
  }, [clearTimer, releaseStream]);

  return { status, elapsedSecs, recorded, stream, start, stop, reset };
}
