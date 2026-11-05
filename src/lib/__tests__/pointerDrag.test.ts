import { describe, expect, it } from "vite-plus/test";
import { DRAG_THRESHOLD, edgeScroll } from "../pointerDrag";

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
