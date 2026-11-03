import { describe, expect, it } from "vite-plus/test";
import type { Task } from "../../model/types";
import { fillPlannedDays, groupPlannedDays, toPlanTask, type PlannedDay } from "../plan";
import { planSchedule, type PlannedTask } from "../schedule";

const TODAY = "2026-10-20";

function planned(id: string, start: string, end: string): PlannedTask {
  return { id, start, end, startHour: 0, conflict: false };
}

function day(date: string, rows = 0): PlannedDay {
  return {
    date,
    weekday: date,
    isToday: date === TODAY,
    spans: [],
    rows: Array.from({ length: rows }, (_, index) => ({
      task: { id: `${date}-${index}` } as PlannedDay["rows"][number]["task"],
      end: date,
      spans: false,
      days: 1,
      conflict: false,
    })),
  };
}

function task(id: string, effortMinutes = 480, extra: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    effortMinutes,
    expectedStartDate: null,
    expectedFinishDate: null,
    exclusive: false,
    ...extra,
  } as Task;
}

describe("groupPlannedDays", () => {
  it("adds a continuation entry for each later day of a span", () => {
    const tasks = [task("a", 960)];
    const plan = planSchedule(tasks.map(toPlanTask), TODAY);
    const days = groupPlannedDays(tasks, plan, TODAY);

    expect(days.map((entry) => entry.date)).toEqual([TODAY, "2026-10-21"]);
    expect(days[0].rows[0]).toMatchObject({ spans: true, days: 2, end: "2026-10-21" });
    expect(days[0].spans).toEqual([]);
    expect(days[1].rows).toEqual([]);
    expect(days[1].spans).toEqual([
      { task: tasks[0], end: "2026-10-21", day: 2, total: 2, hours: 8 },
    ]);
  });

  it("numbers the span days across a weekend", () => {
    const tasks = [task("a", 960)];
    const start = "2026-10-23";
    const days = groupPlannedDays(tasks, planSchedule(tasks.map(toPlanTask), start), start);

    expect(days.map((entry) => entry.date)).toEqual([start, "2026-10-26"]);
    expect(days[1].spans[0]).toMatchObject({ day: 2, total: 2, hours: 8 });
  });

  it("keeps a single-day task free of continuation entries", () => {
    const tasks = [task("a")];
    const days = groupPlannedDays(tasks, planSchedule(tasks.map(toPlanTask), TODAY), TODAY);

    expect(days).toHaveLength(1);
    expect(days[0].rows[0]).toMatchObject({ spans: false, days: 1 });
    expect(days[0].spans).toEqual([]);
  });

  it("shows a continuation next to a task that starts that day", () => {
    const tasks = [task("a", 960), task("b", 480, { expectedStartDate: "2026-10-21" })];
    const days = groupPlannedDays(tasks, planSchedule(tasks.map(toPlanTask), TODAY), TODAY);

    expect(days[1].rows.map((row) => row.task.id)).toEqual(["b"]);
    expect(days[1].spans.map((span) => span.task.id)).toEqual(["a"]);
  });
});

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
