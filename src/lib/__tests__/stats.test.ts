import { describe, expect, it } from "vite-plus/test";
import {
  breakdownRows,
  bucketize,
  busiestDay,
  daysBetween,
  granularityFor,
  heatmapGrid,
  labelStride,
  onTimeRate,
  personDays,
  rangeDays,
  weekdayTotals,
} from "../stats";
import type { DayStats, StatsSlice } from "../../model/types";

function day(date: string, completed: number, created = 0): DayStats {
  return { date, completed, created };
}

function slice(name: string | null, completed: number, minutes = completed * 480): StatsSlice {
  return { id: name, name, completed, minutes };
}

const range = { from: "2026-10-01", to: "2026-10-30" };

describe("range math", () => {
  it("counts both ends", () => {
    expect(daysBetween("2026-10-01", "2026-10-02")).toBe(1);
    expect(rangeDays({ from: "2026-10-01", to: "2026-10-01" })).toBe(1);
    expect(rangeDays(range)).toBe(30);
  });

  it("treats a backwards range as empty", () => {
    expect(rangeDays({ from: "2026-10-30", to: "2026-10-01" })).toBe(0);
  });
});

describe("granularityFor", () => {
  it("keeps a month on daily columns", () => {
    expect(granularityFor(range)).toBe("day");
    expect(granularityFor({ from: "2026-10-01", to: "2026-11-04" })).toBe("day");
  });

  it("switches to weeks past five weeks and to months past half a year", () => {
    expect(granularityFor({ from: "2026-10-01", to: "2026-11-05" })).toBe("week");
    // 2026-01-01..07-01 is 182 days and still weekly; a day more is not.
    expect(granularityFor({ from: "2026-01-01", to: "2026-07-01" })).toBe("week");
    expect(granularityFor({ from: "2026-01-01", to: "2026-07-02" })).toBe("month");
  });
});

describe("bucketize", () => {
  it("fills the quiet days with zeros", () => {
    const buckets = bucketize(range, [day("2026-10-03", 2, 1)], "day");
    expect(buckets).toHaveLength(30);
    expect(buckets[0]).toEqual({ key: "2026-10-01", completed: 0, created: 0 });
    expect(buckets[2]).toEqual({ key: "2026-10-03", completed: 2, created: 1 });
  });

  it("sums a week onto its Monday", () => {
    // 2026-10-05 is a Monday.
    const buckets = bucketize(
      { from: "2026-10-05", to: "2026-10-18" },
      [day("2026-10-05", 1), day("2026-10-09", 2, 3), day("2026-10-12", 4)],
      "week",
    );
    expect(buckets.map((b) => [b.key, b.completed, b.created])).toEqual([
      ["2026-10-05", 3, 3],
      ["2026-10-12", 4, 0],
    ]);
  });

  it("collapses a month onto its first day's key", () => {
    const buckets = bucketize(
      { from: "2026-01-15", to: "2026-03-02" },
      [day("2026-01-20", 2), day("2026-01-31", 1), day("2026-03-01", 5)],
      "month",
    );
    expect(buckets.map((b) => [b.key, b.completed])).toEqual([
      ["2026-01", 3],
      ["2026-02", 0],
      ["2026-03", 5],
    ]);
  });

  it("ignores days outside the range", () => {
    const buckets = bucketize(
      { from: "2026-10-01", to: "2026-10-02" },
      [day("2026-09-30", 9), day("2026-10-01", 1), day("2026-10-02", 2)],
      "day",
    );
    expect(buckets.reduce((sum, b) => sum + b.completed, 0)).toBe(3);
  });

  it("returns nothing for a backwards range", () => {
    expect(bucketize({ from: "2026-10-02", to: "2026-10-01" }, [], "day")).toEqual([]);
  });
});

describe("labelStride", () => {
  it("keeps eight or fewer labels", () => {
    expect(labelStride(30)).toBe(4);
    expect(labelStride(7)).toBe(1);
    expect(labelStride(0)).toBe(1);
  });
});

describe("heatmapGrid", () => {
  it("starts on the Monday of the first week and keeps rows aligned", () => {
    // 2026-10-01 is a Thursday, so the grid opens on 2026-09-28.
    const { rows, weeks } = heatmapGrid({ from: "2026-10-01", to: "2026-10-11" }, [
      day("2026-10-01", 3, 1),
    ]);
    expect(weeks[0]).toBe("2026-09-28");
    expect(rows).toHaveLength(7);
    expect(rows[0].cells[0]).toEqual({ date: "2026-09-28", completed: -1 });
    expect(rows[3].cells[0]).toEqual({ date: "2026-10-01", completed: 3 });
  });

  it("marks days after the range end as empty too", () => {
    const { rows, weeks } = heatmapGrid({ from: "2026-10-01", to: "2026-10-02" }, []);
    expect(weeks).toEqual(["2026-09-28"]);
    // Monday..Wednesday sit before the range, Thursday..Friday inside it,
    // and the weekend after its end.
    expect(rows.slice(0, 3).map((row) => row.cells[0].completed)).toEqual([-1, -1, -1]);
    expect(rows.slice(3, 5).map((row) => row.cells[0].completed)).toEqual([0, 0]);
    expect(rows.slice(5).map((row) => row.cells[0].completed)).toEqual([-1, -1]);
  });
});

describe("weekdayTotals", () => {
  it("runs Monday first", () => {
    const totals = weekdayTotals([
      day("2026-10-05", 1), // Monday
      day("2026-10-05", 0),
      day("2026-10-11", 4), // Sunday
    ]);
    expect(totals).toEqual([1, 0, 0, 0, 0, 0, 4]);
  });
});

describe("busiestDay", () => {
  it("picks the largest day and ignores quiet ones", () => {
    expect(busiestDay([day("2026-10-01", 0), day("2026-10-02", 3), day("2026-10-03", 2)])).toEqual({
      date: "2026-10-02",
      completed: 3,
    });
    expect(busiestDay([day("2026-10-01", 0)])).toBeNull();
  });
});

describe("breakdownRows", () => {
  it("keeps the top ranks in count order and merges the tail", () => {
    const rows = breakdownRows(
      [slice("A", 2), slice("B", 9), slice("C", 5), slice("D", 1), slice("E", 3)],
      3,
    );
    expect(rows.map((row) => [row.name, row.completed, row.merged])).toEqual([
      ["B", 9, false],
      ["C", 5, false],
      ["E", 3, false],
      [null, 3, true],
    ]);
    expect(rows[3].minutes).toBe((2 + 1) * 480);
  });

  it("leaves a list that exactly fills the ranks alone", () => {
    const rows = breakdownRows([slice("A", 2), slice("B", 1)], 2);
    expect(rows.every((row) => !row.merged)).toBe(true);
  });

  it("merges the sixth rank onwards", () => {
    const names = ["A", "B", "C", "D", "E", "F", "G"];
    const rows = breakdownRows(
      names.map((name, index) => slice(name, 20 - index)),
      5,
    );
    expect(rows).toHaveLength(6);
    expect(rows[5]).toMatchObject({ name: null, merged: true, completed: 15 + 14 });
  });
});

describe("display helpers", () => {
  it("has no rate without a denominator", () => {
    expect(onTimeRate(0, 0)).toBeNull();
    expect(onTimeRate(18, 23)).toBe(78);
  });

  it("formats person-days", () => {
    expect(personDays(0)).toBe("0.0");
    expect(personDays(4560)).toBe("9.5");
    expect(personDays(48_000)).toBe("100");
  });
});
