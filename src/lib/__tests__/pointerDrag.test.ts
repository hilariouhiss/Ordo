import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { DRAG_THRESHOLD, edgeScroll, usePointerDrag } from "../pointerDrag";

function pointer(x: number, y: number): PointerEvent {
  return {
    clientX: x,
    clientY: y,
    pointerId: 1,
    currentTarget: { setPointerCapture: vi.fn() },
  } as unknown as PointerEvent;
}

function drag(release: (moved: boolean) => void, drop = vi.fn()) {
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  // The composable registers an unmount hook; outside a component Vue only warns.
  vi.spyOn(console, "warn").mockImplementation(() => {});
  return usePointerDrag<{ day: string }>({
    targetOf: () => null,
    scroller: () => null,
    drop,
    onRelease: release,
  });
}

describe("edgeScroll", () => {
  it("scrolls towards the edge the pointer sits on", () => {
    expect(edgeScroll(10, 800)).toBeLessThan(0);
    expect(edgeScroll(795, 800)).toBeGreaterThan(0);
  });

  it("stays put in the middle of the window", () => {
    expect(edgeScroll(400, 800)).toBe(0);
  });

  it("starts only inside the edge band", () => {
    expect(edgeScroll(55, 800)).toBeLessThan(0);
    expect(edgeScroll(57, 800)).toBe(0);
    expect(edgeScroll(800 - 57, 800)).toBe(0);
    expect(edgeScroll(800 - 55, 800)).toBeGreaterThan(0);
  });
});

describe("DRAG_THRESHOLD", () => {
  it("is larger than a sloppy click and small enough to feel immediate", () => {
    expect(DRAG_THRESHOLD).toBeGreaterThanOrEqual(3);
    expect(DRAG_THRESHOLD).toBeLessThanOrEqual(8);
  });
});

describe("usePointerDrag", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reports a real drag even when the release finds no target", () => {
    const released: boolean[] = [];
    const drop = vi.fn();
    const dragState = drag((moved) => released.push(moved), drop);

    dragState.start(pointer(10, 10), "t1");
    dragState.move(pointer(30, 30));
    dragState.end();

    expect(released).toEqual([true]);
    expect(drop).not.toHaveBeenCalled();
  });

  it("reports a plain click as no drag", () => {
    const released: boolean[] = [];
    const dragState = drag((moved) => released.push(moved));

    dragState.start(pointer(10, 10), "t1");
    dragState.end();

    expect(released).toEqual([false]);
  });
});
