export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Decelerating progress for window travel; no overshoot, so the card never bounces. */
export function easeOutCubic(progress: number): number {
  const t = Math.max(0, Math.min(1, progress));
  return 1 - (1 - t) ** 3;
}

/** Whole physical pixels each frame; the window setters take integers. */
export function lerpRect(from: Rect, to: Rect, progress: number): Rect {
  const t = Math.max(0, Math.min(1, progress));
  const mix = (a: number, b: number): number => Math.round(a + (b - a) * t);
  return {
    x: mix(from.x, to.x),
    y: mix(from.y, to.y),
    width: mix(from.width, to.width),
    height: mix(from.height, to.height),
  };
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
