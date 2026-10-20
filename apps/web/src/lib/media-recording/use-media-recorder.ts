"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type RecorderKind = "audio" | "video";

export type RecorderStatus =
  | "idle"
  | "requesting-permission"
  | "countdown"
  | "recording"
  | "checking"
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
  /** Seconds of "3, 2, 1" between tapping record and recording. 0 to start at once. */
  countdownSecs?: number;
}

const MP4_VIDEO = [
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4;codecs=avc1,mp4a.40.2",
  "video/mp4",
];
const WEBM_VIDEO = ["video/webm;codecs=vp8,opus", "video/webm"];

/**
 * Set once a video recorded as MP4 on this phone turned out blank or
 * unplayable. Some Android phones' Chrome reports MP4 recording as
 * supported and then produces a black video (seen on a Samsung tablet,
 * Oct 2026). WebM/VP8 is Chrome's oldest, most dependable recording
 * path, so the next attempt uses it. Kept for the tab's lifetime.
 */
let avoidMp4Video = false;

function pickMimeType(kind: RecorderKind): string | undefined {
  // MP4 (H.264/AAC) first wherever the browser can record it: it is the
  // one format every recipient's phone plays, iPhones included. WebM is
  // the fallback for browsers that can't record MP4 (older Android
  // Chrome, Firefox) — and for phones whose MP4 recordings came out blank.
  const candidates =
    kind === "video"
      ? avoidMp4Video
        ? [...WEBM_VIDEO, ...MP4_VIDEO]
        : [...MP4_VIDEO, ...WEBM_VIDEO]
      : ["audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm;codecs=opus", "audio/webm"];

  if (typeof MediaRecorder === "undefined") return undefined;
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

type VideoCheck = "ok" | "blank" | "unplayable";

/**
 * Plays the recording back off-screen and looks at it: does it decode,
 * and is there a picture? A recording can be "successful" as far as
 * MediaRecorder is concerned and still be a black rectangle — which the
 * sender might not notice and the recipient certainly would.
 *
 * Errs towards "ok": anything slow or inconclusive (old phone, a seek
 * that never answers) passes, because wrongly blocking a good video is
 * worse than missing a bad one. Only a decode error or two genuinely
 * black frames count as a failure.
 */
async function checkVideo(url: string, durationSecs: number): Promise<VideoCheck> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";

  const loaded = await new Promise<"loaded" | "error" | "timeout">((resolve) => {
    const timer = window.setTimeout(() => resolve("timeout"), 6000);
    video.onloadeddata = () => {
      window.clearTimeout(timer);
      resolve("loaded");
    };
    video.onerror = () => {
      window.clearTimeout(timer);
      resolve("error");
    };
    video.src = url;
  });
  if (loaded === "error") return "unplayable";
  if (loaded === "timeout") return "ok";
  if (video.videoWidth === 0 || video.videoHeight === 0) return "unplayable";

  // Two moments, not one: front cameras often give a few black frames
  // while they wake up, so a dark first second alone proves nothing.
  const moments = [Math.min(1, durationSecs / 3), Math.max(0.5, durationSecs * 0.6)];
  let darkFrames = 0;
  for (const at of moments) {
    const brightness = await frameBrightness(video, at);
    if (brightness === null) return "ok";
    if (brightness < 16) darkFrames += 1;
  }
  video.removeAttribute("src");
  video.load();
  return darkFrames === moments.length ? "blank" : "ok";
}

/** The brightest channel value in a tiny copy of the frame at `at` seconds, or null if it couldn't be read. */
async function frameBrightness(video: HTMLVideoElement, at: number): Promise<number | null> {
  const seeked = await new Promise<boolean>((resolve) => {
    const timer = window.setTimeout(() => resolve(false), 3000);
    video.onseeked = () => {
      window.clearTimeout(timer);
      resolve(true);
    };
    video.currentTime = at;
  });
  if (!seeked) return null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, 16, 16);
    const { data } = ctx.getImageData(0, 0, 16, 16);
    let max = 0;
    for (let i = 0; i < data.length; i += 4) {
      max = Math.max(max, data[i], data[i + 1], data[i + 2]);
    }
    return max;
  } catch {
    return null;
  }
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
export function useMediaRecorder({ kind, maxDurationSecs, initial, countdownSecs = 3 }: UseMediaRecorderOptions) {
  const [status, setStatus] = useState<RecorderStatus>(() =>
    initial ? "recorded" : isRecordingSupported() ? "idle" : "unsupported",
  );
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const [recorded, setRecorded] = useState<RecordedMedia | null>(initial ?? null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  /** Why the last recording was thrown away, in words for the sender. Cleared on the next start. */
  const [problem, setProblem] = useState<string | null>(null);
  /** Seconds left before recording starts, while status is "countdown". */
  const [countdown, setCountdown] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);
  const timerRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);
  const countdownRef = useRef<number | null>(null);
  const clearCountdown = useCallback(() => {
    if (countdownRef.current) window.clearInterval(countdownRef.current);
    countdownRef.current = null;
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

  /** Tapped during the countdown: nothing was recorded, so just put the camera away. */
  const cancel = useCallback(() => {
    clearCountdown();
    releaseStream();
    setCountdown(0);
    setStatus(isRecordingSupported() ? "idle" : "unsupported");
  }, [clearCountdown, releaseStream]);

  const start = useCallback(async () => {
    if (!isRecordingSupported()) {
      setStatus("unsupported");
      return;
    }

    setProblem(null);
    setStatus("requesting-permission");
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        // Phone-screen size, not camera size: a 30 s message stays a few
        // MB, which is the recipient's data bill. 640×480 rather than a
        // square: it's a size every camera and hardware encoder has, so
        // the browser isn't asked to crop and re-encode an odd shape.
        video:
          kind === "video"
            ? { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 } }
            : false,
      });
      streamRef.current = mediaStream;
      setStream(mediaStream);
      // From here the recorder is built now but only started after the
      // countdown — see beginRecording below.

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
        // The recorder's own type, not just the one asked for: the
        // browser may have chosen differently.
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || mimeType || (kind === "video" ? "video/webm" : "audio/webm"),
        });
        const url = URL.createObjectURL(blob);
        const durationSecs = Math.round((Date.now() - startedAtRef.current) / 1000);
        releaseStream();

        if (kind !== "video") {
          setRecorded({ blob, url, durationSecs });
          setStatus("recorded");
          return;
        }

        setStatus("checking");
        void checkVideo(url, durationSecs).then((result) => {
          if (result === "ok") {
            setRecorded({ blob, url, durationSecs });
            setStatus("recorded");
            return;
          }
          URL.revokeObjectURL(url);
          const wasMp4 = blob.type.includes("mp4");
          if (wasMp4 && !avoidMp4Video) {
            avoidMp4Video = true;
            setProblem(
              "That video didn't record properly on this phone. Please record it again — we'll use a different format this time.",
            );
          } else {
            setProblem(
              "Video isn't recording properly on this phone. Please send a voice note or a written message instead.",
            );
          }
          setStatus(isRecordingSupported() ? "idle" : "unsupported");
        });
      };

      recorderRef.current = recorder;

      const beginRecording = () => {
        // Cancelled during the countdown: the stream is already gone.
        if (streamRef.current !== mediaStream) return;
        startedAtRef.current = Date.now();
        recorder.start();
        setStatus("recording");
        setElapsedSecs(0);
        timerRef.current = window.setInterval(() => {
          const secs = (Date.now() - startedAtRef.current) / 1000;
          setElapsedSecs(secs);
          if (secs >= maxDurationSecs) stop();
        }, 200);
      };

      // "3, 2, 1" with the camera already on. Two reasons, beyond giving
      // the sender a breath: they can see themselves and frame the shot
      // before anything counts, and the camera has warmed up by the time
      // recording starts — so no dark first frames, and no lost first word.
      if (countdownSecs <= 0) {
        beginRecording();
        return;
      }
      setCountdown(countdownSecs);
      setStatus("countdown");
      let left = countdownSecs;
      countdownRef.current = window.setInterval(() => {
        left -= 1;
        if (left > 0) {
          setCountdown(left);
          return;
        }
        clearCountdown();
        setCountdown(0);
        beginRecording();
      }, 1000);
    } catch {
      // Covers permission denial, no device present, and insecure-context
      // failures alike — MediaRecorder's error variety isn't worth
      // surfacing distinctly here; "text still works" is the actionable
      // message regardless of which one it was.
      setStatus("permission-denied");
      releaseStream();
    }
  }, [kind, maxDurationSecs, countdownSecs, clearCountdown, releaseStream, stop]);

  const reset = useCallback(() => {
    if (recorded) URL.revokeObjectURL(recorded.url);
    setRecorded(null);
    setElapsedSecs(0);
    setStatus(isRecordingSupported() ? "idle" : "unsupported");
  }, [recorded]);

  useEffect(() => {
    return () => {
      clearTimer();
      clearCountdown();
      releaseStream();
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
      // Deliberately not revoking `recorded`'s object URL on unmount —
      // ownership of that Blob/URL passes to the caller via onRecorded,
      // and this hook doesn't know whether they still need it (e.g.
      // navigating between wizard phases and back).
    };
  }, [clearTimer, clearCountdown, releaseStream]);

  return { status, elapsedSecs, recorded, stream, problem, countdown, start, stop, cancel, reset };
}
