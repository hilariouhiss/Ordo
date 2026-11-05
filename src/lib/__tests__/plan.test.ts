import { describe, expect, it } from "vite-plus/test";
import type { Task } from "../../model/types";
import {
  addDoneRows,
  fillPlannedDays,
  groupPlannedDays,
  toPlanTask,
  type PlannedDay,
} from "../plan";
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
    isPast: date < TODAY,
    rows: Array.from({ length: rows }, (_, index) => ({
      task: { id: `${date}-${index}` } as PlannedDay["rows"][number]["task"],
      start: date,
      end: date,
      spans: false,
      days: 1,
      clamped: false,
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
  it("puts the same row on every day a span covers", () => {
    const tasks = [task("a", 960)];
    const plan = planSchedule(tasks.map(toPlanTask), TODAY);
    const days = groupPlannedDays(tasks, plan, TODAY);

    expect(days.map((entry) => entry.date)).toEqual([TODAY, "2026-10-21"]);
    expect(days[0].rows[0]).toMatchObject({ spans: true, days: 2, end: "2026-10-21" });
    expect(days[1].rows).toEqual([days[0].rows[0]]);
  });

  it("repeats the row across a weekend", () => {
    const tasks = [task("a", 960)];
    const start = "2026-10-23";
    const days = groupPlannedDays(tasks, planSchedule(tasks.map(toPlanTask), start), start);

    expect(days.map((entry) => entry.date)).toEqual([start, "2026-10-26"]);
    expect(days[1].rows[0].task.id).toBe("a");
  });

  it("repeats a task whose estimate overflows its day", () => {
    const tasks = [task("a", 500)];
    const days = groupPlannedDays(tasks, planSchedule(tasks.map(toPlanTask), TODAY), TODAY);

    expect(days.map((entry) => entry.date)).toEqual([TODAY, "2026-10-21"]);
    expect(days[1].rows[0]).toMatchObject({ spans: true, days: 2, end: "2026-10-21" });
  });

  it("keeps a single-day task on one day", () => {
    const tasks = [task("a")];
    const days = groupPlannedDays(tasks, planSchedule(tasks.map(toPlanTask), TODAY), TODAY);

    expect(days).toHaveLength(1);
    expect(days[0].rows[0]).toMatchObject({ spans: false, days: 1 });
  });

  it("keeps a span on its start day when the caller repeats nothing", () => {
    const tasks = [task("a", 960)];
    const days = groupPlannedDays(
      tasks,
      planSchedule(tasks.map(toPlanTask), TODAY),
      TODAY,
      undefined,
      false,
    );

    expect(days.map((entry) => entry.date)).toEqual([TODAY]);
    expect(days[0].rows[0]).toMatchObject({ spans: true, days: 2 });
  });

  it("clamps a task that starts after the week end onto that last day", () => {
    const tasks = [task("a", 1440, { expectedStartDate: "2026-11-10" })];
    const days = groupPlannedDays(
      tasks,
      planSchedule(tasks.map(toPlanTask), TODAY),
      TODAY,
      "2026-10-23",
    );

    expect(days.map((entry) => entry.date)).toEqual(["2026-10-23"]);
    expect(days[0].rows[0]).toMatchObject({ start: "2026-11-10", clamped: true, spans: true });
  });

  it("cuts a span at the week end", () => {
    const tasks = [task("a", 1440, { expectedStartDate: "2026-10-22" })];
    const days = groupPlannedDays(
      tasks,
      planSchedule(tasks.map(toPlanTask), TODAY),
      TODAY,
      "2026-10-23",
    );

    expect(days.map((entry) => entry.date)).toEqual(["2026-10-22", "2026-10-23"]);
    expect(days[1].rows[0]).toMatchObject({ days: 3, end: "2026-10-26" });
  });

  it("reads a repeated row before a task that starts that day", () => {
    const tasks = [task("a", 960), task("b", 480, { expectedStartDate: "2026-10-21" })];
    const days = groupPlannedDays(tasks, planSchedule(tasks.map(toPlanTask), TODAY), TODAY);

    expect(days[1].rows.map((row) => row.task.id)).toEqual(["a", "b"]);
  });
});

describe("addDoneRows", () => {
  const WEEK = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"];
  const stamp = (day: number) => new Date(2026, 9, day, 15, 0).toISOString();

  it("puts a finished task on the day it was done", () => {
    const finished = task("a", 480, { status: "done", actualFinishAt: stamp(21) });
    const days = addDoneRows([], [finished], WEEK, TODAY);

    expect(days.map((entry) => entry.date)).toEqual(["2026-10-21"]);
    expect(days[0].rows[0]).toMatchObject({ history: true, start: "2026-10-21" });
  });

  it("keeps every day a finished span covered", () => {
    const finished = task("a", 1440, {
      status: "done",
      expectedStartDate: "2026-10-20",
      actualFinishAt: stamp(22),
    });
    const days = addDoneRows([], [finished], WEEK, TODAY);

    expect(days.map((entry) => entry.date)).toEqual(["2026-10-20", "2026-10-21", "2026-10-22"]);
    for (const entry of days) {
      expect(entry.rows).toHaveLength(1);
      expect(entry.rows[0]).toMatchObject({
        history: true,
        spans: true,
        days: 3,
        end: "2026-10-22",
      });
    }
  });

  it("stops a finished span at this week's last workday", () => {
    const finished = task("a", 1440, {
      status: "done",
      expectedStartDate: "2026-10-22",
      actualFinishAt: stamp(23),
    });
    const days = addDoneRows([], [finished], WEEK, TODAY);

    expect(days.map((entry) => entry.date)).toEqual(["2026-10-22", "2026-10-23"]);
  });

  it("keeps the finish day when the plan starts after it", () => {
    const finished = task("a", 480, {
      status: "done",
      expectedStartDate: "2026-10-23",
      actualFinishAt: stamp(21),
    });
    const days = addDoneRows([], [finished], WEEK, TODAY);

    expect(days.map((entry) => entry.date)).toEqual(["2026-10-21"]);
    expect(days[0].rows[0]).toMatchObject({ history: true, spans: false, days: 1 });
  });

  it("falls back to the planned day when the finish is outside the week", () => {
    const finished = task("a", 480, {
      status: "done",
      expectedStartDate: "2026-10-22",
      actualFinishAt: stamp(27),
    });
    expect(addDoneRows([], [finished], WEEK, TODAY).map((entry) => entry.date)).toEqual([
      "2026-10-22",
    ]);
  });

  it("leaves out a finish of an earlier week", () => {
    const finished = task("a", 480, {
      status: "done",
      expectedStartDate: "2026-10-15",
      actualFinishAt: stamp(26),
    });
    expect(addDoneRows([], [finished], WEEK, TODAY)).toEqual([]);
  });

  it("reads the finished row after the day's planned work", () => {
    const work = task("p");
    const days = groupPlannedDays([work], planSchedule([toPlanTask(work)], TODAY), TODAY);
    const finished = task("d", 480, { status: "done", actualFinishAt: stamp(20) });
    const merged = addDoneRows(days, [finished], ["2026-10-19", "2026-10-20"], TODAY);

    expect(merged[0].rows.map((row) => row.task.id)).toEqual(["p", "d"]);
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
