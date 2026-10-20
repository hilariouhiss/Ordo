import { describe, expect, it } from "vite-plus/test";
import { planSchedule, type PlanTask } from "../schedule";

function t(id: string, effortDays: number, dueDate: string | null = null): PlanTask {
  return { id, effortDays, dueDate };
}

describe("planSchedule", () => {
  it("puts one one-day task per working day from the start", () => {
    const plan = planSchedule([t("a", 1), t("b", 1)], "2026-10-20");
    expect(plan.map((p) => [p.start, p.end])).toEqual([
      ["2026-10-20", "2026-10-20"],
      ["2026-10-21", "2026-10-21"],
    ]);
  });

  it("rolls a weekend start to Monday", () => {
    const plan = planSchedule([t("a", 1)], "2026-10-24");
    expect(plan[0].start).toBe("2026-10-26");
  });

  it("packs two half days into one day", () => {
    const plan = planSchedule([t("a", 0.5), t("b", 0.5), t("c", 1)], "2026-10-20");
    expect(plan.map((p) => p.start)).toEqual(["2026-10-20", "2026-10-20", "2026-10-21"]);
  });

  it("spans a multi-day task over the weekend", () => {
    const plan = planSchedule([t("a", 2)], "2026-10-23");
    expect(plan[0]).toEqual({ id: "a", start: "2026-10-23", end: "2026-10-26", conflict: false });
  });

  it("flags a finish after the due date and not one on it", () => {
    const plan = planSchedule(
      [t("late", 1, "2026-10-19"), t("fit", 1, "2026-10-21")],
      "2026-10-20",
    );
    expect(plan[0].conflict).toBe(true);
    expect(plan[1].conflict).toBe(false);
  });

  it("treats a missing or zero effort as half a day", () => {
    const plan = planSchedule([t("zero", 0), t("half", 0.5)], "2026-10-20");
    expect(plan[0]).toEqual({
      id: "zero",
      start: "2026-10-20",
      end: "2026-10-20",
      conflict: false,
    });
    expect(plan[1]).toEqual({
      id: "half",
      start: "2026-10-20",
      end: "2026-10-20",
      conflict: false,
    });
  });

  it("returns nothing for an empty list", () => {
    expect(planSchedule([], "2026-10-20")).toEqual([]);
  });
});
