import { describe, expect, it } from "vite-plus/test";
import { LOAD_WARN_HOURS, planLoads, planSchedule, type PlanTask } from "../schedule";

const TODAY = "2026-10-20";

// The tests speak in days; the planner takes minutes and books whole hours.
function t(id: string, days: number, extra: Partial<PlanTask> = {}): PlanTask {
  return { id, effortMinutes: days * 480, dueDate: null, ...extra };
}

function minutes(id: string, value: number, extra: Partial<PlanTask> = {}): PlanTask {
  return { id, effortMinutes: value, dueDate: null, ...extra };
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
      startHour: 0,
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

  it("lets an explicit start date take the day the queue would use", () => {
    expect(
      spans([
        t("queued", 1, { exclusive: true }),
        t("pinned", 1, { exclusive: true, startDate: TODAY }),
      ]),
    ).toEqual([
      ["2026-10-21", "2026-10-21"],
      [TODAY, TODAY],
    ]);
  });

  it("places the earliest pinned exclusive task first", () => {
    expect(
      spans([
        t("later", 1, { exclusive: true, startDate: "2026-10-21" }),
        t("earlier", 2, { exclusive: true, startDate: TODAY }),
      ]),
    ).toEqual([
      ["2026-10-22", "2026-10-22"],
      [TODAY, "2026-10-21"],
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

  it("lets a half-day exclusive task leave the rest of the day free", () => {
    expect(spans([t("x", 0.5, { exclusive: true }), t("s", 1)])).toEqual([
      [TODAY, TODAY],
      [TODAY, "2026-10-21"],
    ]);
  });

  it("packs two half-day exclusive tasks into one day", () => {
    expect(spans([t("x1", 0.5, { exclusive: true }), t("x2", 0.5, { exclusive: true })])).toEqual([
      [TODAY, TODAY],
      [TODAY, TODAY],
    ]);
  });

  it("lets a short exclusive task share the last half of a longer one", () => {
    expect(
      spans([t("long", 1.5, { exclusive: true }), t("short", 0.5, { exclusive: true })]),
    ).toEqual([
      [TODAY, "2026-10-21"],
      ["2026-10-21", "2026-10-21"],
    ]);
  });

  it("packs four two-hour exclusive tasks into one day", () => {
    expect(
      spans([
        minutes("a", 120, { exclusive: true }),
        minutes("b", 120, { exclusive: true }),
        minutes("c", 120, { exclusive: true }),
        minutes("d", 120, { exclusive: true }),
      ]),
    ).toEqual([
      [TODAY, TODAY],
      [TODAY, TODAY],
      [TODAY, TODAY],
      [TODAY, TODAY],
    ]);
  });

  it("rounds a sub-hour exclusive task up to one hour", () => {
    expect(
      spans([
        minutes("short", 30, { exclusive: true }),
        minutes("seven", 420, { exclusive: true }),
      ]),
    ).toEqual([
      [TODAY, TODAY],
      [TODAY, TODAY],
    ]);
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

  it("splits a task that starts in the free hours of a day", () => {
    const tasks = [t("x", 0.5, { exclusive: true }), t("s", 1)];
    const plan = planSchedule(tasks, TODAY);
    expect(Object.fromEntries(planLoads(tasks, plan))).toEqual({
      "2026-10-20": 8,
      "2026-10-21": 4,
    });
  });

  it("counts a task from the day it is pushed to", () => {
    const tasks = [t("x", 1, { exclusive: true }), t("s", 1)];
    const plan = planSchedule(tasks, TODAY);
    expect(Object.fromEntries(planLoads(tasks, plan))).toEqual({
      "2026-10-20": 8,
      "2026-10-21": 8,
    });
  });

  it("warns above two person-days", () => {
    const tasks = [t("a", 1), t("b", 1), t("c", 1)];
    const loads = planLoads(tasks, planSchedule(tasks, TODAY));
    expect(loads.get(TODAY)).toBeGreaterThan(LOAD_WARN_HOURS);
  });
});
