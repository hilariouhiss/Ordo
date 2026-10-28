import type { DeskRect } from "./deskWindow";

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

/** How much a fixed-layout surface must stretch to fill another size. */
export function rectScale(
  from: { width: number; height: number },
  to: { width: number; height: number },
): { x: number; y: number } {
  return {
    x: from.width > 0 ? to.width / from.width : 1,
    y: from.height > 0 ? to.height / from.height : 1,
  };
}

/** Translate that keeps `inner`'s centre at its screen position inside `container`. */
export function centerOffset(inner: Rect, container: Rect, dpi: number): { x: number; y: number } {
  return {
    x: (inner.x + inner.width / 2 - (container.x + container.width / 2)) / dpi,
    y: (inner.y + inner.height / 2 - (container.y + container.height / 2)) / dpi,
  };
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** A widget rect (position + size) as the flat rect the motion helpers take. */
export function flatRect(rect: DeskRect): Rect {
  return {
    x: rect.position.x,
    y: rect.position.y,
    width: rect.size.width,
    height: rect.size.height,
  };
}

/**
 * One frame per animation frame until the target is reached; `onFrame` returns false
 * when a newer tween took over. The timer covers a hidden webview that stops frames.
 */
export function tweenRect(
  from: Rect,
  to: Rect,
  ms: number,
  onFrame: (rect: Rect) => boolean,
): Promise<void> {
  return new Promise((resolve) => {
    const started = performance.now();
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    timer = setTimeout(finish, ms + 500);
    const step = (now: number): void => {
      if (done) return;
      const progress = Math.min(1, (now - started) / ms);
      if (!onFrame(lerpRect(from, to, easeOutCubic(progress)))) {
        finish();
        return;
      }
      if (progress < 1) requestAnimationFrame(step);
      else finish();
    };
    requestAnimationFrame(step);
  });
}
