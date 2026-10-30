import { describe, expect, it } from "vite-plus/test";
import { fillPlannedDays, type PlannedDay } from "../plan";
import type { PlannedTask } from "../schedule";

const TODAY = "2026-10-20";

function planned(id: string, start: string, end: string): PlannedTask {
  return { id, start, end, startHour: 0, conflict: false };
}

function day(date: string, rows = 0): PlannedDay {
  return {
    date,
    weekday: date,
    isToday: date === TODAY,
    rows: Array.from({ length: rows }, (_, index) => ({
      task: { id: `${date}-${index}` } as PlannedDay["rows"][number]["task"],
      end: date,
      spans: false,
      conflict: false,
    })),
  };
}

describe("fillPlannedDays", () => {
  it("adds a group for every date without work", () => {
    const days = fillPlannedDays([day(TODAY, 1)], [TODAY, "2026-10-21"], [], TODAY);

    expect(days.map((entry) => entry.date)).toEqual([TODAY, "2026-10-21"]);
    expect(days[1].rows).toEqual([]);
    expect(days[1].isToday).toBe(false);
  });

  it("keeps the days' order no matter where the gap sits", () => {
    const days = fillPlannedDays(
      [day("2026-10-22", 1), day("2026-10-20", 1)],
      ["2026-10-21"],
      [],
      TODAY,
    );

    expect(days.map((entry) => entry.date)).toEqual(["2026-10-20", "2026-10-21", "2026-10-22"]);
  });

  it("skips a day a multi-day task already covers", () => {
    const plan = [planned("a", "2026-10-20", "2026-10-21")];
    const days = fillPlannedDays([day(TODAY, 1)], ["2026-10-21", "2026-10-22"], plan, TODAY);

    expect(days.map((entry) => entry.date)).toEqual([TODAY, "2026-10-22"]);
  });

  it("leaves the list alone when there is nothing to add", () => {
    const original = [day(TODAY, 1)];
    expect(fillPlannedDays(original, [TODAY], [], TODAY)).toEqual(original);
  });
});
