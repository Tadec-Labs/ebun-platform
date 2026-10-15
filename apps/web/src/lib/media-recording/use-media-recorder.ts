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
  // MP4 (H.264/AAC) first wherever the browser can record it: it is the
  // one format every recipient's phone plays, iPhones included. WebM is
  // the fallback for browsers that can't record MP4 (older Android
  // Chrome, Firefox).
  const candidates =
    kind === "video"
      ? [
          "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
          "video/mp4;codecs=avc1,mp4a.40.2",
          "video/mp4",
          "video/webm;codecs=vp8,opus",
          "video/webm",
        ]
      : ["audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm;codecs=opus", "audio/webm"];

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
 * Wraps MediaRecorder for a fixed-length voice or video note. The output
 * is a local Blob + object URL; it is uploaded with the order itself
 * (lib/orders/create-order.ts) when the sender pays.
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
        // Phone-screen size, not camera size: a 30 s message stays a few
        // MB, which is the recipient's data bill.
        video:
          kind === "video"
            ? { facingMode: "user", width: { ideal: 640 }, height: { ideal: 640 }, frameRate: { ideal: 24, max: 30 } }
            : false,
      });
      streamRef.current = mediaStream;
      setStream(mediaStream);

      chunksRef.current = [];
      const mimeType = pickMimeType(kind);
      // Bitrate hints keep a 60 s voice note near 0.5 MB and a 30 s video
      // near 3.5 MB; the API refuses anything far beyond that.
      const recorder = new MediaRecorder(mediaStream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: 64_000,
        ...(kind === "video" ? { videoBitsPerSecond: 800_000 } : {}),
      });
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
