import { describe, expect, it } from "vite-plus/test";
import {
  areaOf,
  clampToArea,
  collapsedTab,
  dockPoint,
  growRect,
  nearestEdge,
  pickArea,
  pickAreaForPoint,
  rightCenter,
  shrinkRect,
  snapToEdge,
  topRight,
  widgetPlacement,
  type DeskMonitor,
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

describe("growRect", () => {
  it("turns a card rect into the window rect with its shadow margin", () => {
    expect(growRect({ position: { x: 1588, y: 290 }, size }, 16)).toEqual({
      position: { x: 1572, y: 274 },
      size: { width: 352, height: 492 },
    });
  });
});

describe("shrinkRect", () => {
  it("turns a window rect back into the card rect", () => {
    expect(
      shrinkRect({ position: { x: 1572, y: 274 }, size: { width: 352, height: 492 } }, 16),
    ).toEqual({ position: { x: 1588, y: 290 }, size });
  });
});

describe("dockPoint", () => {
  it("snaps a card near an edge flush and reports that edge", () => {
    expect(dockPoint({ x: 1588, y: 290 }, size, primary, 24)).toEqual({
      position: { x: 1600, y: 290 },
      edge: "right",
    });
  });

  it("clamps an out-of-bounds card to the edge it lands on", () => {
    expect(dockPoint({ x: 700, y: 900 }, size, primary, 24)).toEqual({
      position: { x: 700, y: 580 },
      edge: "bottom",
    });
  });

  it("leaves a free card in the middle alone", () => {
    expect(dockPoint({ x: 700, y: 300 }, size, primary, 24)).toEqual({
      position: { x: 700, y: 300 },
      edge: null,
    });
  });

  it("finds the edge after clamping a spot saved for a narrower panel", () => {
    expect(dockPoint({ x: 1600, y: 290 }, { width: 360, height: 500 }, primary, 24)).toEqual({
      position: { x: 1560, y: 290 },
      edge: "right",
    });
  });
});

describe("collapsedTab", () => {
  it("hugs each work-area edge with its long side pointing inward", () => {
    const panel = { width: 360, height: 500 };
    const horizontal = { width: 56, height: 22 };
    const vertical = { width: 22, height: 56 };
    expect(collapsedTab("right", { x: 1560, y: 270 }, panel, 56, 22, primary)).toEqual({
      position: { x: 1864, y: 509 },
      size: horizontal,
    });
    expect(collapsedTab("left", { x: 0, y: 270 }, panel, 56, 22, primary)).toEqual({
      position: { x: 0, y: 509 },
      size: horizontal,
    });
    expect(collapsedTab("top", { x: 780, y: 0 }, panel, 56, 22, primary)).toEqual({
      position: { x: 949, y: 0 },
      size: vertical,
    });
    expect(collapsedTab("bottom", { x: 780, y: 540 }, panel, 56, 22, primary)).toEqual({
      position: { x: 949, y: 984 },
      size: vertical,
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

const primaryMonitor: DeskMonitor = { ...primary, scale: 1 };
const secondMonitor: DeskMonitor = { ...second, scale: 1.25 };
const panel = { width: 360, height: 500 };

describe("topRight", () => {
  it("hugs the work area's top-right corner", () => {
    expect(topRight(primary, size)).toEqual({ x: 1600, y: 0 });
  });
});

describe("pickAreaForPoint", () => {
  it("uses the monitor that contains the point", () => {
    expect(
      pickAreaForPoint({ x: -900, y: 200 }, [primaryMonitor, secondMonitor], primaryMonitor),
    ).toBe(secondMonitor);
  });

  it("uses the nearest monitor for a point that is gone", () => {
    expect(
      pickAreaForPoint({ x: 5000, y: 5000 }, [primaryMonitor, secondMonitor], secondMonitor),
    ).toBe(primaryMonitor);
  });
});

describe("widgetPlacement", () => {
  it("defaults to the primary monitor's top-right corner", () => {
    const placed = widgetPlacement({
      saved: null,
      monitors: [primaryMonitor, secondMonitor],
      primary: primaryMonitor,
    });
    expect(placed.card).toEqual({ position: { x: 1560, y: 0 }, size: panel });
    expect(placed.edge).toBe("right");
    expect(placed.window).toEqual({
      position: { x: 1544, y: -16 },
      size: { width: 392, height: 532 },
    });
    expect(placed.pad).toBe(16);
    expect(placed.snap).toBe(24);
  });

  it("scales card, pad and snap on the target monitor", () => {
    const placed = widgetPlacement({
      saved: null,
      monitors: [primaryMonitor, secondMonitor],
      primary: secondMonitor,
    });
    expect(placed.card.size).toEqual({ width: 450, height: 625 });
    expect(placed.window).toEqual({
      position: { x: -470, y: -20 },
      size: { width: 490, height: 665 },
    });
    expect(placed.pad).toBe(20);
    expect(placed.snap).toBe(30);
  });

  it("docks a saved position on its own monitor", () => {
    const placed = widgetPlacement({
      saved: { x: 1580, y: 300 },
      monitors: [primaryMonitor],
      primary: primaryMonitor,
    });
    expect(placed.card.position).toEqual({ x: 1560, y: 300 });
    expect(placed.edge).toBe("right");
  });

  it("clamps a saved position whose monitor is gone", () => {
    const placed = widgetPlacement({
      saved: { x: 5000, y: 5000 },
      monitors: [primaryMonitor],
      primary: primaryMonitor,
    });
    expect(placed.card.position).toEqual({ x: 1560, y: 540 });
    expect(placed.edge).toBe("right");
  });
});
