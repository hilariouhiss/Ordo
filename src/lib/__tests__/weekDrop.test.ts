import { describe, expect, it } from "vite-plus/test";
import { ganttDropAt, listDropAt } from "../weekDrop";

interface Rect {
  top: number;
  bottom: number;
  left?: number;
  width?: number;
}

/** Just enough of an element for the drop math: rect, dataset, and the children it lists. */
function element(
  rect: Rect,
  options: { dataset?: Record<string, string>; children?: HTMLElement[] } = {},
): HTMLElement {
  const { top, bottom, left = 0, width = 0 } = rect;
  return {
    dataset: options.dataset ?? {},
    getBoundingClientRect: () => ({
      top,
      bottom,
      left,
      width,
      right: left + width,
      height: bottom - top,
      x: left,
      y: top,
      toJSON: () => ({}),
    }),
    querySelectorAll: () => options.children ?? [],
  } as unknown as HTMLElement;
}

function grid(children: HTMLElement[], rect: { left: number; width: number }): HTMLElement {
  return element({ top: 0, bottom: 1000, ...rect }, { children });
}

describe("listDropAt", () => {
  const row = (id: string, top: number) =>
    element({ top, bottom: top + 40 }, { dataset: { taskId: id } });
  const section = (date: string, top: number, bottom: number, rows: HTMLElement[] = []) =>
    element({ top, bottom }, { dataset: { day: date }, children: rows });

  const monday = section("2026-11-02", 0, 100);
  const tuesday = section("2026-11-03", 100, 200, [row("r1", 110), row("r2", 160)]);
  const list = grid([monday, tuesday], { left: 0, width: 600 });

  it("reads the day whose block holds the pointer", () => {
    expect(listDropAt(list, 50)).toEqual({ day: "2026-11-02", beforeId: null });
    expect(listDropAt(list, 150)).toEqual({ day: "2026-11-03", beforeId: "r2" });
  });

  it("anchors above the row whose midpoint the pointer has not passed", () => {
    expect(listDropAt(list, 175)).toEqual({ day: "2026-11-03", beforeId: "r2" });
    expect(listDropAt(list, 190)).toEqual({ day: "2026-11-03", beforeId: null });
  });

  it("returns null outside the list", () => {
    expect(listDropAt(list, 250)).toBeNull();
    expect(listDropAt(null, 10)).toBeNull();
  });
});

describe("ganttDropAt", () => {
  const lane = (id: string, top: number) =>
    element({ top, bottom: top + 46 }, { dataset: { lane: id } });
  const gridEl = grid([lane("a", 0), lane("b", 46), lane("c", 92)], { left: 100, width: 500 });

  it("turns the pointer into a column and the lane under it", () => {
    expect(ganttDropAt(gridEl, 150, 10, 5)).toEqual({ column: 0, before: "a" });
    expect(ganttDropAt(gridEl, 260, 60, 5)).toEqual({ column: 1, before: "b" });
  });

  it("clamps a pointer outside the columns and reads no lane below the last one", () => {
    expect(ganttDropAt(gridEl, 0, 200, 5)).toEqual({ column: 0, before: null });
    expect(ganttDropAt(gridEl, 660, 200, 5)).toEqual({ column: 4, before: null });
  });

  it("returns null without a grid", () => {
    expect(ganttDropAt(null, 200, 10, 5)).toBeNull();
  });
});
