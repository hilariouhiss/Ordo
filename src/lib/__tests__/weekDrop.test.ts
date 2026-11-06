import { describe, expect, it } from "vite-plus/test";
import { boardDropAt, listDropAt } from "../weekDrop";

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

describe("boardDropAt", () => {
  const card = (id: string, top: number) =>
    element({ top, bottom: top + 40 }, { dataset: { taskId: id } });
  const panel = (date: string, left: number, width: number, cards: HTMLElement[] = []) =>
    element({ top: 0, bottom: 200, left, width }, { dataset: { day: date }, children: cards });
  const board = element(
    { top: 0, bottom: 200, left: 0, width: 500 },
    {
      children: [
        panel("2026-11-02", 0, 160, [card("a", 10), card("b", 60)]),
        panel("2026-11-03", 170, 160, [card("c", 10)]),
      ],
    },
  );

  it("reads the day under the pointer and the card it sits above", () => {
    expect(boardDropAt(board, 10, 20)).toEqual({ day: "2026-11-02", beforeId: "a" });
    expect(boardDropAt(board, 10, 55)).toEqual({ day: "2026-11-02", beforeId: "b" });
    expect(boardDropAt(board, 200, 100)).toEqual({ day: "2026-11-03", beforeId: null });
  });

  it("picks the topmost of two overlapping past-day cards", () => {
    const deck = element(
      { top: 0, bottom: 200, left: 0, width: 400 },
      {
        children: [panel("2026-11-02", 0, 160), panel("2026-11-03", 44, 160)],
      },
    );

    expect(boardDropAt(deck, 10, 50)).toEqual({ day: "2026-11-02", beforeId: null });
    expect(boardDropAt(deck, 60, 50)).toEqual({ day: "2026-11-03", beforeId: null });
  });

  it("falls back to the nearest day for a pointer in the gap", () => {
    expect(boardDropAt(board, 165, 150)).toEqual({ day: "2026-11-02", beforeId: null });
    expect(boardDropAt(board, 168, 150)).toEqual({ day: "2026-11-03", beforeId: null });
  });

  it("lets an open past-day card win inside the today column's overlap", () => {
    const open = panel("2026-11-02", 0, 168);
    const today = panel("2026-11-06", 44, 456);
    const overlapping = element(
      { top: 0, bottom: 200, left: 0, width: 500 },
      {
        children: [open, today],
      },
    );

    expect(boardDropAt(overlapping, 100, 50)).toEqual({ day: "2026-11-06", beforeId: null });
    expect(boardDropAt(overlapping, 100, 50, "2026-11-02")).toEqual({
      day: "2026-11-02",
      beforeId: null,
    });
  });

  it("returns null outside the board or without one", () => {
    expect(boardDropAt(board, 10, 300)).toBeNull();
    expect(boardDropAt(null, 10, 10)).toBeNull();
  });
});
