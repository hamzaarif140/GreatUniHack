"use client";

import { useEffect, useRef } from "react";

const BARS = 32;

interface VoiceVisualizerProps {
  /** Draws only while true. */
  active: boolean;
  color: string;
  /** Current loudness, 0-1, or null to animate a natural speaking rhythm instead. */
  getLevel: () => number | null;
  className?: string;
}

/**
 * A ring of bars that pulses with a voice, drawn around whatever sits in the middle.
 * Without real audio (browser voices, voices off) it animates a speech-like rhythm.
 */
export function VoiceVisualizer({ active, color, getLevel, className }: VoiceVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const getLevelRef = useRef(getLevel);
  useEffect(() => {
    getLevelRef.current = getLevel;
  }, [getLevel]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const bars = new Float32Array(BARS);
    const seeds = Array.from({ length: BARS }, (_, i) => 1 + ((i * 7919) % 97) / 97);
    let frame = 0;
    let level = 0;
    const started = performance.now();

    function draw(now: number) {
      if (!canvas || !context) return;
      const dpr = window.devicePixelRatio || 1;
      const size = Math.round(canvas.clientWidth * dpr);
      if (canvas.width !== size || canvas.height !== size) {
        canvas.width = size;
        canvas.height = size;
      }
      context.clearRect(0, 0, size, size);

      const t = (now - started) / 1000;
      const measured = active ? getLevelRef.current() : 0;
      // Syllable-like bursts when there is nothing to measure.
      const target =
        measured ??
        0.35 + 0.3 * Math.abs(Math.sin(t * 7.3)) * (0.6 + 0.4 * Math.sin(t * 2.1)) + 0.15 * Math.random();
      level += (target - level) * (target > level ? 0.45 : 0.12);

      const centre = size / 2;
      const inner = size * 0.33;
      const room = size * 0.16;
      context.lineCap = "round";
      context.lineWidth = Math.max(2, size * 0.022);
      context.strokeStyle = color;

      let drawing = false;
      for (let i = 0; i < BARS; i++) {
        const wobble = 0.55 + 0.45 * Math.sin(t * 9 * seeds[i] + i * 1.7);
        const want = active ? level * wobble : 0;
        bars[i] += (want - bars[i]) * 0.3;
        if (bars[i] > 0.01) drawing = true;
        const length = 2 + bars[i] * room;
        const angle = (i / BARS) * Math.PI * 2 - Math.PI / 2;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        context.globalAlpha = 0.45 + 0.55 * Math.min(1, bars[i] * 1.6);
        context.beginPath();
        context.moveTo(centre + cos * inner, centre + sin * inner);
        context.lineTo(centre + cos * (inner + length), centre + sin * (inner + length));
        context.stroke();
      }
      context.globalAlpha = 1;

      // Keep animating while speaking, and until the bars have settled afterwards.
      if (active || drawing) frame = requestAnimationFrame(draw);
      else context.clearRect(0, 0, size, size);
    }

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [active, color]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
