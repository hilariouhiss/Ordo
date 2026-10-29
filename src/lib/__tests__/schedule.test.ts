import { describe, expect, it } from "vite-plus/test";
import {
  exclusiveConflict,
  LOAD_WARN_HALF_DAYS,
  planLoads,
  planSchedule,
  type PlanTask,
} from "../schedule";

const TODAY = "2026-10-20";

// The tests speak in days; the planner takes minutes.
function t(id: string, days: number, extra: Partial<PlanTask> = {}): PlanTask {
  return { id, effortMinutes: days * 480, dueDate: null, ...extra };
}

function spans(tasks: PlanTask[]) {
  return planSchedule(tasks, TODAY).map((p) => [p.start, p.end]);
}

describe("planSchedule", () => {
  it("starts every shared task on the same day", () => {
    expect(spans([t("a", 1), t("b", 1)])).toEqual([
      [TODAY, TODAY],
      [TODAY, TODAY],
    ]);
  });

  it("rolls a weekend start to Monday", () => {
    expect(planSchedule([t("a", 1)], "2026-10-24")[0].start).toBe("2026-10-26");
  });

  it("spans a multi-day task over the weekend", () => {
    expect(planSchedule([t("a", 2)], "2026-10-23")[0]).toEqual({
      id: "a",
      start: "2026-10-23",
      end: "2026-10-26",
      conflict: false,
    });
  });

  it("flags a finish after the due date and not one on it", () => {
    const plan = planSchedule(
      [t("late", 1, { dueDate: "2026-10-19" }), t("fit", 1, { dueDate: "2026-10-21" })],
      TODAY,
    );
    expect(plan[0].conflict).toBe(true);
    expect(plan[1].conflict).toBe(false);
  });

  it("treats a missing or zero effort as half a day", () => {
    expect(planSchedule([t("zero", 0), t("half", 0.5)], TODAY)).toEqual([
      { id: "zero", start: TODAY, end: TODAY, conflict: false },
      { id: "half", start: TODAY, end: TODAY, conflict: false },
    ]);
  });

  it("returns nothing for an empty list", () => {
    expect(planSchedule([], TODAY)).toEqual([]);
  });

  it("anchors a future task on its own start date", () => {
    expect(spans([t("a", 1, { startDate: "2026-10-22" })])).toEqual([["2026-10-22", "2026-10-22"]]);
  });

  it("pulls a past start date back to today", () => {
    expect(spans([t("a", 1, { startDate: "2026-10-19" })])).toEqual([[TODAY, TODAY]]);
  });

  it("rolls a weekend start date to Monday", () => {
    expect(spans([t("a", 1, { startDate: "2026-10-24" })])).toEqual([["2026-10-26", "2026-10-26"]]);
  });

  it("queues exclusive tasks after one another in list order", () => {
    expect(spans([t("x1", 1, { exclusive: true }), t("x2", 1, { exclusive: true })])).toEqual([
      [TODAY, TODAY],
      ["2026-10-21", "2026-10-21"],
    ]);
  });

  it("keeps a later exclusive task where it is when nothing overlaps", () => {
    expect(
      spans([
        t("x1", 1, { exclusive: true, startDate: "2026-10-22" }),
        t("x2", 1, { exclusive: true }),
      ]),
    ).toEqual([
      ["2026-10-22", "2026-10-22"],
      [TODAY, TODAY],
    ]);
  });

  it("pushes shared work past an exclusive span", () => {
    expect(spans([t("x", 1, { exclusive: true }), t("s", 2)])).toEqual([
      [TODAY, TODAY],
      ["2026-10-21", "2026-10-22"],
    ]);
  });

  it("pushes shared work past two exclusive spans in a row", () => {
    expect(
      spans([t("x1", 1, { exclusive: true }), t("x2", 1, { exclusive: true }), t("s", 2)]),
    ).toEqual([
      [TODAY, TODAY],
      ["2026-10-21", "2026-10-21"],
      ["2026-10-22", "2026-10-23"],
    ]);
  });

  it("lets a half-day exclusive task hold the whole day", () => {
    expect(spans([t("x", 0.5, { exclusive: true }), t("s", 1)])).toEqual([
      [TODAY, TODAY],
      ["2026-10-21", "2026-10-21"],
    ]);
  });
});

describe("planLoads", () => {
  it("sums half-days per working day", () => {
    const tasks = [t("a", 2), t("b", 1)];
    const loads = planLoads(tasks, planSchedule(tasks, TODAY));
    expect(Object.fromEntries(loads)).toEqual({
      "2026-10-20": 4,
      "2026-10-21": 2,
    });
  });

  it("skips weekends", () => {
    const tasks = [t("a", 2)];
    const plan = planSchedule(tasks, "2026-10-23");
    expect(Object.fromEntries(planLoads(tasks, plan))).toEqual({
      "2026-10-23": 2,
      "2026-10-26": 2,
    });
  });

  it("counts a task from the day it is pushed to", () => {
    const tasks = [t("x", 1, { exclusive: true }), t("s", 1)];
    const plan = planSchedule(tasks, TODAY);
    expect(Object.fromEntries(planLoads(tasks, plan))).toEqual({
      "2026-10-20": 2,
      "2026-10-21": 2,
    });
  });

  it("warns above two person-days", () => {
    const tasks = [t("a", 1), t("b", 1), t("c", 1)];
    const loads = planLoads(tasks, planSchedule(tasks, TODAY));
    expect(loads.get(TODAY)).toBeGreaterThan(LOAD_WARN_HALF_DAYS);
  });
});

describe("exclusiveConflict", () => {
  it("reports the exclusive task and where the new task lands", () => {
    const tasks = [t("x", 1, { exclusive: true }), t("s", 1)];
    expect(exclusiveConflict(tasks[1], tasks, TODAY)).toEqual({
      taskId: "x",
      start: "2026-10-20",
      end: "2026-10-20",
      plannedStart: "2026-10-21",
    });
  });

  it("stays quiet when the natural span misses the exclusive days", () => {
    const tasks = [t("x", 1, { exclusive: true }), t("s", 1, { startDate: "2026-10-22" })];
    expect(exclusiveConflict(tasks[1], tasks, TODAY)).toBeNull();
  });

  it("stays quiet when nothing is exclusive", () => {
    const tasks = [t("a", 1), t("b", 1)];
    expect(exclusiveConflict(tasks[0], tasks, TODAY)).toBeNull();
  });

  it("ignores shared tasks sitting on the same day", () => {
    const tasks = [t("a", 2), t("b", 1)];
    expect(exclusiveConflict(tasks[1], tasks, TODAY)).toBeNull();
  });
});
