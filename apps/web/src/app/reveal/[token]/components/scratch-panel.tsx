"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface ScratchPanelProps {
  className?: string;
  /** Portion of the foil (0..1) that must be cleared before it auto-completes. */
  revealThreshold?: number;
  onRevealed: () => void;
  children: React.ReactNode;
  fallbackLabel?: string;
}

/**
 * A scratch-card mechanic over arbitrary content: `children` renders
 * underneath a canvas "foil" layer, which the visitor drags a pointer
 * across to erase (`destination-out` compositing). Crossing
 * `revealThreshold` auto-clears the remainder.
 *
 * The underlying content is NOT aria-hidden — the foil is a visual
 * flourish, not an access gate, so screen reader / keyboard users get
 * the content immediately via the always-visible "reveal without
 * scratching" button rather than being blocked by a gesture they can't
 * perform. That button is a real requirement here, not a nicety: there
 * is no keyboard equivalent of a scratch drag.
 */
export function ScratchPanel({
  className,
  revealThreshold = 0.55,
  onRevealed,
  children,
  fallbackLabel = "Reveal without scratching",
}: ScratchPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const isDrawingRef = useRef(false);
  const progressTimerRef = useRef<number | null>(null);
  const revealedRef = useRef(false);
  const [revealing, setRevealing] = useState(false);
  const [foilGone, setFoilGone] = useState(false);

  const drawFoil = useCallback((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);

    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#8a6f32");
    gradient.addColorStop(0.5, "#c9a84c");
    gradient.addColorStop(1, "#8a6f32");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Repeated wordmark texture reads as "this is foil", the way a real
    // scratch ticket's metallic pattern does — not decoration for its
    // own sake.
    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = "#0e0d0b";
    ctx.font = `${Math.max(14, width * 0.045)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textBaseline = "middle";
    const step = Math.max(70, width * 0.22);
    for (let y = step * 0.5; y < height; y += step * 0.6) {
      for (let x = -step; x < width + step; x += step) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(-0.35);
        ctx.fillText("EBUN", 0, 0);
        ctx.restore();
      }
    }
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = "#0e0d0b";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `500 ${Math.max(11, width * 0.03)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillText("SCRATCH TO REVEAL", width / 2, height / 2);
    ctx.restore();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      drawFoil(canvas);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => observer.disconnect();
  }, [drawFoil]);

  const triggerReveal = useCallback(() => {
    if (revealedRef.current) return;
    revealedRef.current = true;
    if (progressTimerRef.current) window.clearInterval(progressTimerRef.current);
    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setRevealing(true);
    window.setTimeout(
      () => {
        setFoilGone(true);
        onRevealed();
      },
      prefersReducedMotion ? 0 : 420,
    );
  }, [onRevealed]);

  const checkProgress = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { width, height } = canvas;
    const stride = 6;
    let transparent = 0;
    let total = 0;
    const data = ctx.getImageData(0, 0, width, height).data;
    for (let y = 0; y < height; y += stride) {
      for (let x = 0; x < width; x += stride) {
        const alpha = data[(y * width + x) * 4 + 3];
        if (alpha < 40) transparent += 1;
        total += 1;
      }
    }
    if (total > 0 && transparent / total >= revealThreshold) {
      triggerReveal();
    }
  }, [revealThreshold, triggerReveal]);

  const scratchAt = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;
    const radius = Math.max(canvas.width, canvas.height) * 0.055;

    ctx.globalCompositeOperation = "destination-out";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = radius * 2;

    if (lastPointRef.current) {
      ctx.beginPath();
      ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
      ctx.lineTo(x, y);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    lastPointRef.current = { x, y };
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (revealedRef.current) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      isDrawingRef.current = true;
      lastPointRef.current = null;
      scratchAt(e.clientX, e.clientY);
      if (progressTimerRef.current) window.clearInterval(progressTimerRef.current);
      progressTimerRef.current = window.setInterval(checkProgress, 180);
    },
    [checkProgress, scratchAt],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!isDrawingRef.current || revealedRef.current) return;
      scratchAt(e.clientX, e.clientY);
    },
    [scratchAt],
  );

  const endStroke = useCallback(() => {
    isDrawingRef.current = false;
    lastPointRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      if (progressTimerRef.current) window.clearInterval(progressTimerRef.current);
    };
  }, []);

  return (
    <div ref={containerRef} className={`relative ${className ?? ""}`}>
      <div className="absolute inset-0">{children}</div>
      {!foilGone && (
        <>
          <canvas
            ref={canvasRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endStroke}
            onPointerCancel={endStroke}
            onPointerLeave={endStroke}
            className="absolute inset-0 h-full w-full touch-none transition-opacity duration-[420ms] ease-out"
            style={{ opacity: revealing ? 0 : 1, cursor: "pointer" }}
            aria-hidden="true"
          />
          <button
            type="button"
            onClick={triggerReveal}
            className="absolute bottom-4 left-1/2 -translate-x-1/2 text-[11px] tracking-wide underline underline-offset-4"
            style={{ color: "var(--cream-dim)", textDecorationColor: "var(--gold-dim)" }}
          >
            {fallbackLabel}
          </button>
        </>
      )}
    </div>
  );
}
