"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Scans the QR on a recipient's screen with the counter phone's camera.
 *
 * Uses the browser's built-in BarcodeDetector rather than a scanning
 * library: it ships in Chrome on Android — what most counter phones in
 * Lagos run — and costs nothing in bundle size. Where it doesn't exist
 * (iPhone Safari, older Android browsers) this renders nothing at all,
 * and typing the code stays the way in. No half-working fallback.
 *
 * Scanning only fills in the code and looks it up. It never confirms a
 * collection: that stays a separate, deliberate tap, because collection
 * is single-use and can't be undone.
 *
 * The QR carries the same EBN- code printed under it (see
 * RevealService), so anything this reads that isn't shaped like one is
 * rejected here rather than sent to the API.
 */

// BarcodeDetector is not in TypeScript's DOM lib yet. Only the parts
// used here are declared.
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorInstance {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
}
interface BarcodeDetectorConstructor {
  new (options: { formats: string[] }): BarcodeDetectorInstance;
  getSupportedFormats(): Promise<string[]>;
}

const CODE_SHAPE = /^(EBN-?)?[A-Z0-9]{6}$/i;
const SCAN_INTERVAL_MS = 250;

function detectorConstructor(): BarcodeDetectorConstructor | null {
  if (typeof window === "undefined") return null;
  const candidate = (
    window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }
  ).BarcodeDetector;
  return candidate ?? null;
}

export function QrScanner({
  onCode,
  onAvailable,
}: {
  onCode: (code: string) => void;
  /** Told once, after mount, whether scanning works on this phone. */
  onAvailable?: (available: boolean) => void;
}) {
  const [supported, setSupported] = useState(false);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);

  // Decided after mount, never during render: the server has no camera
  // and no BarcodeDetector, and guessing would mismatch hydration.
  useEffect(() => {
    const Detector = detectorConstructor();
    if (!Detector || !navigator.mediaDevices?.getUserMedia) {
      onAvailable?.(false);
      return;
    }
    Detector.getSupportedFormats()
      .then((formats) => {
        const ok = formats.includes("qr_code");
        setSupported(ok);
        onAvailable?.(ok);
      })
      .catch(() => {
        setSupported(false);
        onAvailable?.(false);
      });
    // Run once on mount; onAvailable is a setter from the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stop = useCallback(() => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setOpen(false);
  }, []);

  // The camera light must go off if the vendor navigates away mid-scan.
  useEffect(() => stop, [stop]);

  async function start() {
    const Detector = detectorConstructor();
    if (!Detector) return;
    setMessage(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      setOpen(true);
      // The <video> mounts on this render; attach on the next frame.
      requestAnimationFrame(() => {
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        void video.play();
        const detector = new Detector({ formats: ["qr_code"] });
        timerRef.current = window.setInterval(async () => {
          if (video.readyState < 2) return;
          try {
            const [hit] = await detector.detect(video);
            if (!hit) return;
            const value = hit.rawValue.trim();
            if (!CODE_SHAPE.test(value)) {
              setMessage(
                "That QR isn't an Ebun code. Ask them to open their gift link.",
              );
              return;
            }
            stop();
            onCode(value.toUpperCase());
          } catch {
            // A single failed frame is normal (motion blur, focus). Keep going.
          }
        }, SCAN_INTERVAL_MS);
      });
    } catch {
      stop();
      setMessage(
        "Couldn't open the camera. Allow camera access for this page, or type the code instead.",
      );
    }
  }

  if (!supported) return null;

  return (
    <div className="flex flex-col gap-3">
      {open ? (
        <div className="flex flex-col gap-3">
          <div className="relative overflow-hidden rounded-lg bg-black">
            <video
              ref={videoRef}
              muted
              playsInline
              className="aspect-square w-full object-cover"
              aria-label="Camera view for scanning the gift QR code"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-[18%] rounded-lg border-4 border-white/80"
            />
          </div>
          <p className="text-center text-lg text-zinc-600">
            Point at the QR on their screen
          </p>
          <button
            type="button"
            onClick={stop}
            className="w-full rounded-lg border-2 border-zinc-300 py-4 text-lg font-medium"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => void start()}
          className="w-full rounded-lg border-2 border-zinc-900 py-5 text-xl font-semibold"
        >
          Scan their QR
        </button>
      )}
      {message && (
        <p
          role="status"
          className="rounded-lg bg-amber-50 px-4 py-3 text-lg text-amber-900"
        >
          {message}
        </p>
      )}
    </div>
  );
}
