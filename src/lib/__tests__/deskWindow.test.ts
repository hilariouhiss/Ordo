import { describe, expect, it } from "vite-plus/test";
import {
  areaOf,
  clampToArea,
  collapsedRect,
  nearestEdge,
  pickArea,
  rightCenter,
  snapToEdge,
} from "../deskWindow";

const primary = { x: 0, y: 0, width: 1920, height: 1040 };
const second = { x: -1280, y: 0, width: 1280, height: 1024 };
const size = { width: 320, height: 460 };

describe("clampToArea", () => {
  it("pulls a window back inside the work area", () => {
    expect(clampToArea({ x: 1800, y: 900 }, size, primary)).toEqual({ x: 1600, y: 580 });
    expect(clampToArea({ x: -50, y: -20 }, size, primary)).toEqual({ x: 0, y: 0 });
  });

  it("keeps a window that already fits", () => {
    expect(clampToArea({ x: 100, y: 100 }, size, primary)).toEqual({ x: 100, y: 100 });
  });
});

describe("rightCenter", () => {
  it("centers the widget on the right edge", () => {
    expect(rightCenter(primary, size)).toEqual({ x: 1600, y: 290 });
  });
});

describe("nearestEdge", () => {
  it("finds each edge within the tolerance", () => {
    expect(nearestEdge({ x: 10, y: 300 }, size, primary, 24)).toBe("left");
    expect(nearestEdge({ x: 1590, y: 300 }, size, primary, 24)).toBe("right");
    expect(nearestEdge({ x: 300, y: 10 }, size, primary, 24)).toBe("top");
    expect(nearestEdge({ x: 300, y: 570 }, size, primary, 24)).toBe("bottom");
  });

  it("leaves a window in the middle free", () => {
    expect(nearestEdge({ x: 700, y: 300 }, size, primary, 24)).toBeNull();
  });
});

describe("snapToEdge", () => {
  it("flushes to the chosen edge and clamps the other axis", () => {
    expect(snapToEdge("right", { x: 1300, y: -100 }, size, primary)).toEqual({ x: 1600, y: 0 });
    expect(snapToEdge("bottom", { x: 900, y: 400 }, size, primary)).toEqual({ x: 900, y: 580 });
  });
});

describe("collapsedRect", () => {
  it("leaves a 12px vertical strip at a side edge", () => {
    expect(collapsedRect("right", { x: 1600, y: 290 }, size, 12, primary)).toEqual({
      position: { x: 1908, y: 290 },
      size: { width: 12, height: 460 },
    });
    expect(collapsedRect("left", { x: 0, y: 900 }, size, 12, primary)).toEqual({
      position: { x: 0, y: 580 },
      size: { width: 12, height: 460 },
    });
  });

  it("leaves a 12px horizontal strip at a top/bottom edge", () => {
    expect(collapsedRect("bottom", { x: 300, y: 580 }, size, 12, primary)).toEqual({
      position: { x: 300, y: 1028 },
      size: { width: 320, height: 12 },
    });
    expect(collapsedRect("top", { x: 300, y: 0 }, size, 12, primary)).toEqual({
      position: { x: 300, y: 0 },
      size: { width: 320, height: 12 },
    });
  });
});

describe("pickArea", () => {
  it("uses the monitor that contains the saved window", () => {
    expect(pickArea({ x: -900, y: 200 }, size, [primary, second], primary)).toBe(second);
  });

  it("falls back to the primary monitor for a missing saved point", () => {
    expect(pickArea(null, size, [primary, second], primary)).toBe(primary);
  });

  it("uses the nearest monitor when the saved point is gone", () => {
    expect(pickArea({ x: 5000, y: 5000 }, size, [primary, second], primary)).toBe(primary);
  });
});

describe("areaOf", () => {
  it("maps a monitor work area", () => {
    expect(areaOf({ position: { x: 10, y: 20 }, size: { width: 300, height: 400 } })).toEqual({
      x: 10,
      y: 20,
      width: 300,
      height: 400,
    });
  });
});
