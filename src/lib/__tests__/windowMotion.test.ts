import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { centerOffset, easeOutCubic, lerpRect, rectScale, tweenRect } from "../windowMotion";

const from = { x: 0, y: 10, width: 200, height: 100 };
const to = { x: 100, y: -10, width: 400, height: 300 };

describe("lerpRect", () => {
  it("returns the endpoints exactly", () => {
    expect(lerpRect(from, to, 0)).toEqual(from);
    expect(lerpRect(from, to, 1)).toEqual(to);
  });

  it("rounds to whole physical pixels at the midpoint", () => {
    expect(lerpRect(from, to, 0.5)).toEqual({ x: 50, y: 0, width: 300, height: 200 });
  });
});

describe("rectScale", () => {
  it("maps a window rect onto another window rect", () => {
    expect(rectScale(from, to)).toEqual({ x: 2, y: 3 });
  });

  it("falls back to 1 when the source has no size", () => {
    expect(rectScale({ width: 0, height: 0 }, to)).toEqual({ x: 1, y: 1 });
  });
});

describe("centerOffset", () => {
  it("keeps the inner rect at its screen position", () => {
    const inner = { x: 900, y: 0, width: 200, height: 150 };
    const container = { x: 100, y: 50, width: 1200, height: 800 };
    expect(centerOffset(inner, container, 1)).toEqual({ x: 300, y: -375 });
  });
});

describe("tweenRect", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Collects the frame callbacks so the test can drive them by hand. */
  function stubFrames(): FrameRequestCallback[] {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    return frames;
  }

  it("paints from the start rect to the target and then stops", async () => {
    const frames = stubFrames();
    const painted: { x: number; y: number }[] = [];
    const done = tweenRect(from, to, 100, (rect) => {
      painted.push({ x: rect.x, y: rect.y });
      return true;
    });

    frames.shift()!(performance.now() - 1_000);
    frames.shift()!(performance.now() + 1_000);
    await done;

    expect(painted[0]).toEqual({ x: from.x, y: from.y });
    expect(painted[painted.length - 1]).toEqual({ x: to.x, y: to.y });
    expect(frames).toHaveLength(0);
  });

  it("stops on the frame that says a newer tween took over", async () => {
    const frames = stubFrames();
    let calls = 0;
    const done = tweenRect(from, to, 100, () => ++calls < 2);

    frames.shift()!(performance.now() - 1_000);
    expect(frames).toHaveLength(1);
    frames.shift()!(performance.now() - 1_000);
    await done;

    expect(calls).toBe(2);
    expect(frames).toHaveLength(0);
  });
});

describe("easeOutCubic", () => {
  it("starts at 0, ends at 1 and decelerates", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.25)).toBeCloseTo(0.578125);
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875);
  });

  it("clamps out-of-range progress", () => {
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(2)).toBe(1);
  });
});
