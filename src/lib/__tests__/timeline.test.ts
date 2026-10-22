import { describe, expect, it } from "vite-plus/test";
import { timelineLayout, type TimelineTask } from "../timeline";

function t(id: string, startDate: string | null, dueDate: string | null): TimelineTask {
  return { id, title: id, startDate, dueDate, categoryId: null, status: "todo" };
}

const range = { start: "2026-10-06", end: "2026-11-17" };

describe("timelineLayout", () => {
  it("maps dates to percentages in a six-week window", () => {
    const row = timelineLayout(range, [t("t1", "2026-10-20", "2026-10-24")])[0];
    expect(row.leftPct).toBeCloseTo(33.33, 1);
    expect(row.widthPct).toBeCloseTo(9.52, 1);
    expect(row.dashedStart).toBe(false);
    expect(row.dashedEnd).toBe(false);
  });

  it("dashes a bar with no start date", () => {
    const row = timelineLayout(range, [t("t2", null, "2026-11-17")])[0];
    expect(row.dashedStart).toBe(true);
    expect(row.leftPct).toBe(0);
  });

  it("extends a start-only bar to the window end", () => {
    const row = timelineLayout(range, [t("t4", "2026-10-20", null)])[0];
    expect(row.dashedEnd).toBe(true);
    expect(row.widthPct).toBeCloseTo(66.67, 1);
  });

  it("clips a bar that starts before the window", () => {
    const row = timelineLayout({ start: "2026-09-29", end: "2026-11-09" }, [
      t("t5", "2026-09-01", "2026-10-10"),
    ])[0];
    expect(row.leftPct).toBe(0);
    expect(row.widthPct).toBeCloseTo(26.83, 1);
  });

  it("keeps a same-day bar visible", () => {
    const row = timelineLayout(range, [t("t6", "2026-10-20", "2026-10-20")])[0];
    expect(row.widthPct).toBeGreaterThan(0);
  });

  it("skips tasks without any date", () => {
    expect(timelineLayout(range, [t("t3", null, null)])).toEqual([]);
  });
});
