import { differenceInCalendarDays, parse } from "date-fns";
import { describe, expect, it } from "vitest";
import { bucketKeys, fillSeries, rangeSpec } from "../series";

/** Local instant, so the assertions hold in any machine timezone. */
const NOW = new Date(2026, 8, 9, 15, 30); // 2026-09-09 15:30 local

function last(values: string[]): string {
  return values[values.length - 1];
}

function isMonday(key: string): boolean {
  return parse(key, "yyyy-MM-dd", new Date()).getDay() === 1;
}

describe("rangeSpec", () => {
  it("covers the last seven local days, today included", () => {
    const spec = rangeSpec("7d", NOW);

    expect(spec.days).toHaveLength(7);
    expect(spec.days[0]).toBe("2026-09-03");
    expect(last(spec.days)).toBe("2026-09-09");
    // Local day boundaries: the range starts at local midnight six days ago
    // and ends at local midnight tomorrow (exclusive).
    expect(spec.from).toBe(new Date(2026, 8, 3).toISOString());
    expect(spec.to).toBe(new Date(2026, 8, 10).toISOString());
    expect(spec.granularity).toBe("day");
    expect(spec.offsetMinutes).toBe(-NOW.getTimezoneOffset());
  });

  it("covers the last thirty local days", () => {
    const spec = rangeSpec("30d", NOW);

    expect(spec.days).toHaveLength(30);
    expect(spec.days[0]).toBe("2026-08-11");
    expect(last(spec.days)).toBe("2026-09-09");
    expect(spec.granularity).toBe("day");
  });

  it("covers the year to date and buckets it weekly", () => {
    const spec = rangeSpec("year", NOW);

    expect(spec.from).toBe(new Date(2026, 0, 1).toISOString());
    expect(spec.to).toBe(new Date(2026, 8, 10).toISOString());
    expect(spec.days[0]).toBe("2026-01-01");
    expect(last(spec.days)).toBe("2026-09-09");
    // A 365-point daily line is noise; the year reads in weekly buckets.
    expect(spec.granularity).toBe("week");
  });
});

describe("bucketKeys", () => {
  it("plots daily buckets as-is", () => {
    const spec = rangeSpec("7d", NOW);
    expect(bucketKeys(spec)).toEqual(spec.days);
  });

  it("labels weekly buckets by their Monday", () => {
    const keys = bucketKeys(rangeSpec("year", NOW));

    // 2026-01-01 is a Thursday, so its week starts on 2025-12-29.
    expect(keys[0]).toBe("2025-12-29");
    // 2026-09-09 is a Wednesday, so the current week starts on 2026-09-07.
    expect(last(keys)).toBe("2026-09-07");
    expect(keys.every(isMonday)).toBe(true);
    expect(differenceInCalendarDays(new Date(keys[1]), new Date(keys[0]))).toBe(7);
  });

  it("labels monthly buckets as yyyy-MM", () => {
    const spec = { ...rangeSpec("year", NOW), granularity: "month" as const };
    expect(bucketKeys(spec)).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
    ]);
  });
});

describe("fillSeries", () => {
  it("zero-fills buckets the backend left out", () => {
    expect(
      fillSeries(
        ["2026-09-07", "2026-09-08", "2026-09-09"],
        [
          { bucket: "2026-09-09", value: 3 },
          { bucket: "2026-09-07", value: 1 },
        ],
      ),
    ).toEqual([1, 0, 3]);
  });

  it("ignores buckets outside the axis", () => {
    expect(fillSeries(["2026-09-09"], [{ bucket: "2026-01-01", value: 9 }])).toEqual([0]);
  });
});
