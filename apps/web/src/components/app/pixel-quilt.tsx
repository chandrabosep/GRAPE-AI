'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import {
  CLOCK_BASE,
  HERO_QUILT,
  clockAdvance,
  paintQuilt,
  type QuiltSettings,
} from '@/lib/pixel-quilt';

/** Longest edge we ever paint. Cells are huge flat fills; past this it is waste. */
const MAX_EDGE = 2560;
/** Retina is worth it for the seams; 3x is not. */
const MAX_DPR = 2;

/**
 * The hero sky.
 *
 * A live canvas rather than a flat image, for three reasons: the grid is sized
 * off the container's short edge, so an image would have to letterbox or
 * stretch at every viewport; the drift and shimmer are what stop the quilt
 * reading as a screenshot; and the whole thing is a few hundred rectangles,
 * which is cheaper to paint than the file that a still of it would need.
 *
 * The loop only runs while the hero is actually on screen and the reader has
 * not asked for less motion. In both of those cases a single frame is painted
 * and left alone — the quilt is a composition first and an animation second, so
 * the still is the real fallback, not a degraded one.
 */
export function PixelQuilt({
  settings = HERO_QUILT,
  className,
}: {
  settings?: QuiltSettings;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const clock = useRef(CLOCK_BASE);
  /* Size lives in a ref, not state: the resize observer and the animation
     frame both need it, and re-rendering React to change a canvas's backing
     store is a round trip for nothing. */
  const size = useRef({ w: 0, h: 0 });

  /* Size the backing store and paint the first frame before the browser gets a
     chance to show the box empty. */
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx || !size.current.w) return;
      paintQuilt(ctx, size.current.w, size.current.h, clock.current, settings);
    };

    const measure = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) return;
      const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
      const fit = Math.min(1, MAX_EDGE / Math.max(rect.width * dpr, rect.height * dpr));
      const w = Math.max(1, Math.round(rect.width * dpr * fit));
      const h = Math.max(1, Math.round(rect.height * dpr * fit));
      if (w === size.current.w && h === size.current.h) return;
      size.current = { w, h };
      canvas.width = w;
      canvas.height = h;
      draw();
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [settings]);

  /* The loop. Separate from the sizing effect so a resize never restarts it and
     drops the clock back to the first frame. */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || settings.speed <= 0) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let last = 0;
    let onScreen = true;

    const tick = (now: number) => {
      const ctx = canvas.getContext('2d');
      if (ctx && size.current.w) {
        if (last) clock.current += clockAdvance(settings.speed, (now - last) / 1000);
        paintQuilt(ctx, size.current.w, size.current.h, clock.current, settings);
      }
      last = now;
      frame = requestAnimationFrame(tick);
    };

    const sync = () => {
      const run = onScreen && !reduced.matches;
      if (run && !frame) {
        last = 0; // so the first frame after a pause advances by nothing
        frame = requestAnimationFrame(tick);
      } else if (!run && frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    };

    const visible = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      sync();
    });
    visible.observe(canvas);
    reduced.addEventListener('change', sync);
    sync();

    return () => {
      visible.disconnect();
      reduced.removeEventListener('change', sync);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [settings]);

  return <canvas ref={canvasRef} aria-hidden="true" className={className} />;
}
