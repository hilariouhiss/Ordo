import { describe, expect, it } from "vite-plus/test";
import {
  LOAD_WARN_HOURS,
  planLoads,
  planSchedule,
  plannedDayParts,
  type PlanTask,
} from "../schedule";

const TODAY = "2026-10-20";

// The tests speak in days; the planner takes minutes and books whole hours.
function t(id: string, days: number, extra: Partial<PlanTask> = {}): PlanTask {
  return { id, effortMinutes: days * 480, expectedFinishDate: null, ...extra };
}

function minutes(id: string, value: number, extra: Partial<PlanTask> = {}): PlanTask {
  return { id, effortMinutes: value, expectedFinishDate: null, ...extra };
}

function spans(tasks: PlanTask[]) {
  return planSchedule(tasks, TODAY).map((p) => [p.start, p.end]);
}

describe("planSchedule", () => {
  it("starts every task on its own day, overlapping freely", () => {
    expect(spans([t("a", 1), t("b", 2)])).toEqual([
      [TODAY, TODAY],
      [TODAY, "2026-10-21"],
    ]);
  });

  it("gives every task the first hour of the day", () => {
    expect(planSchedule([t("a", 1), t("b", 1)], TODAY).map((row) => row.startHour)).toEqual([0, 0]);
  });

  it("rolls a weekend start to Monday", () => {
    expect(planSchedule([t("a", 1)], "2026-10-24")[0].start).toBe("2026-10-26");
  });

  it("spans a multi-day task over the weekend", () => {
    expect(planSchedule([t("a", 2)], "2026-10-23")[0]).toEqual({
      id: "a",
      start: "2026-10-23",
      end: "2026-10-26",
      startHour: 0,
      conflict: false,
    });
  });

  it("flags a finish after the due date and not one on it", () => {
    const plan = planSchedule(
      [t("late", 2, { expectedFinishDate: TODAY }), t("fit", 1, { expectedFinishDate: TODAY })],
      TODAY,
    );
    expect(plan[0]).toMatchObject({ start: TODAY, end: "2026-10-21", conflict: true });
    expect(plan[1]).toMatchObject({ start: TODAY, end: TODAY, conflict: false });
  });

  it("does not flag a due date the plan has already passed", () => {
    const plan = planSchedule([t("overdue", 1, { expectedFinishDate: "2026-10-19" })], TODAY);

    expect(plan[0]).toMatchObject({ start: TODAY, end: TODAY, conflict: false });
  });

  it("treats a missing or zero effort as one hour", () => {
    expect(planSchedule([minutes("zero", 0), minutes("short", 30)], TODAY)).toEqual([
      { id: "zero", start: TODAY, end: TODAY, startHour: 0, conflict: false },
      { id: "short", start: TODAY, end: TODAY, startHour: 0, conflict: false },
    ]);
  });

  it("returns nothing for an empty list", () => {
    expect(planSchedule([], TODAY)).toEqual([]);
  });

  it("anchors a future task on its own start date", () => {
    expect(spans([t("a", 1, { expectedStartDate: "2026-10-22" })])).toEqual([
      ["2026-10-22", "2026-10-22"],
    ]);
  });

  it("spans a deferred task from its start through the new finish", () => {
    // What `defer` writes: the task starts 10/19, the finish moves to 10/20, so the
    // estimate covers both days and the row covers both columns.
    const plan = planSchedule(
      [t("a", 2, { expectedStartDate: "2026-10-19", expectedFinishDate: "2026-10-20" })],
      TODAY,
      "2026-10-19",
    );
    expect([plan[0].start, plan[0].end]).toEqual(["2026-10-19", "2026-10-20"]);
    expect(plan[0].conflict).toBe(false);
  });

  it("pulls a past start date back to today", () => {
    expect(spans([t("a", 1, { expectedStartDate: "2026-10-19" })])).toEqual([[TODAY, TODAY]]);
  });

  it("rolls a weekend start date to Monday", () => {
    expect(spans([t("a", 1, { expectedStartDate: "2026-10-24" })])).toEqual([
      ["2026-10-26", "2026-10-26"],
    ]);
  });

  it("honors a start date inside the week that has already passed", () => {
    const plan = planSchedule(
      [t("a", 1, { expectedStartDate: "2026-10-19" })],
      TODAY,
      "2026-10-19",
    );
    expect(plan[0].start).toBe("2026-10-19");
  });

  it("never plans before the week it shows", () => {
    const plan = planSchedule(
      [t("a", 1, { expectedStartDate: "2026-10-12" })],
      TODAY,
      "2026-10-19",
    );
    expect(plan[0].start).toBe("2026-10-19");
  });
});

describe("plannedDayParts", () => {
  it("splits a two-day task over the weekend", () => {
    const tasks = [t("a", 2)];
    const plan = planSchedule(tasks, "2026-10-23");

    expect(plannedDayParts(tasks[0], plan[0])).toEqual([
      { day: "2026-10-23", hours: 8 },
      { day: "2026-10-26", hours: 8 },
    ]);
  });

  it("fills the first day and carries the rest into the next", () => {
    const tasks = [t("a", 1.5)];
    const plan = planSchedule(tasks, TODAY);

    expect(plannedDayParts(tasks[0], plan[0])).toEqual([
      { day: TODAY, hours: 8 },
      { day: "2026-10-21", hours: 4 },
    ]);
  });

  it("gives a whole day to a task that starts in the morning", () => {
    const tasks = [t("a", 1)];
    const plan = planSchedule(tasks, TODAY);

    expect(plannedDayParts(tasks[0], plan[0])).toEqual([{ day: TODAY, hours: 8 }]);
  });
});

describe("planLoads", () => {
  it("sums hours per working day", () => {
    const tasks = [t("a", 2), t("b", 1)];
    const loads = planLoads(tasks, planSchedule(tasks, TODAY));
    expect(Object.fromEntries(loads)).toEqual({
      "2026-10-20": 16,
      "2026-10-21": 8,
    });
  });

  it("skips weekends", () => {
    const tasks = [t("a", 2)];
    const plan = planSchedule(tasks, "2026-10-23");
    expect(Object.fromEntries(planLoads(tasks, plan))).toEqual({
      "2026-10-23": 8,
      "2026-10-26": 8,
    });
  });

  it("counts overlapping work on the same day", () => {
    const tasks = [t("a", 1), t("b", 1)];
    const loads = planLoads(tasks, planSchedule(tasks, TODAY));
    expect(loads.get(TODAY)).toBe(16);
  });

  it("warns above two person-days", () => {
    const tasks = [t("a", 1), t("b", 1), t("c", 1)];
    const loads = planLoads(tasks, planSchedule(tasks, TODAY));
    expect(loads.get(TODAY)).toBeGreaterThan(LOAD_WARN_HOURS);
  });
});
