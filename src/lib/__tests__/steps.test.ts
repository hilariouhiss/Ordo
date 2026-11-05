import { describe, expect, it } from "vite-plus/test";
import type { Step } from "../../model/types";
import {
  allocateSteps,
  currentStep,
  formatStepClock,
  formatStepEffort,
  stepLabel,
  stepsDone,
} from "../steps";

function step(id: string, done: boolean, effortMinutes: number | null = null): Step {
  return { id, taskId: "t1", title: id, sortOrder: 0, done, effortMinutes };
}

describe("currentStep", () => {
  it("is null without steps", () => {
    expect(currentStep([])).toBeNull();
  });

  it("is the first open step", () => {
    expect(currentStep([step("a", true), step("b", false), step("c", false)])?.id).toBe("b");
  });

  it("is null once every step is done", () => {
    expect(currentStep([step("a", true), step("b", true)])).toBeNull();
  });
});

describe("stepsDone", () => {
  it("counts the done steps", () => {
    expect(stepsDone([step("a", true), step("b", false)])).toBe(1);
  });

  it("is zero without steps", () => {
    expect(stepsDone([])).toBe(0);
  });
});

describe("allocateSteps", () => {
  it("splits the total evenly across automatic steps", () => {
    const allocation = allocateSteps(480, [step("a", false), step("b", false), step("c", false)]);

    expect(allocation.steps.map((row) => row.minutes)).toEqual([160, 160, 160]);
    expect(allocation.allocated).toBe(480);
    expect(allocation.manualCount).toBe(0);
    expect(allocation.steps.every((row) => row.auto)).toBe(true);
  });

  it("keeps manual minutes and splits what is left", () => {
    const allocation = allocateSteps(480, [
      step("a", false),
      step("b", false, 240),
      step("c", false),
    ]);

    expect(allocation.steps.map((row) => row.minutes)).toEqual([120, 240, 120]);
    expect(allocation.manualCount).toBe(1);
  });

  it("spreads whole minutes when the split does not divide", () => {
    expect(
      allocateSteps(100, [step("a", false), step("b", false), step("c", false)]).steps.map(
        (row) => row.minutes,
      ),
    ).toEqual([34, 33, 33]);
  });

  it("leaves automatic steps empty when manual values fill the total", () => {
    const allocation = allocateSteps(480, [
      step("a", false, 240),
      step("b", false, 240),
      step("c", false),
    ]);

    expect(allocation.steps.map((row) => row.minutes)).toEqual([240, 240, 0]);
    expect(allocation.allocated).toBe(480);
  });

  it("reports an over-allocation instead of hiding it", () => {
    const allocation = allocateSteps(480, [
      step("a", false, 180),
      step("b", false, 240),
      step("c", false, 180),
    ]);

    expect(allocation.steps.map((row) => row.minutes)).toEqual([180, 240, 180]);
    expect(allocation.allocated).toBe(600);
    expect(allocation.manualCount).toBe(3);
  });

  it("has nothing to allocate without steps", () => {
    expect(allocateSteps(480, [])).toEqual({ steps: [], allocated: 0, manualCount: 0 });
  });
});

describe("formatStepClock", () => {
  it("shows hours and minutes", () => {
    expect(formatStepClock(160)).toBe("2:40");
    expect(formatStepClock(65)).toBe("1:05");
    expect(formatStepClock(0)).toBe("0:00");
  });
});

describe("formatStepEffort", () => {
  it("keeps a full day in hours", () => {
    expect(formatStepEffort(480)).toBe("8 小时");
    expect(formatStepEffort(160)).toBe("2 小时 40 分");
    expect(formatStepEffort(0)).toBe("0 分钟");
  });
});

describe("stepLabel", () => {
  it("names the current step", () => {
    expect(stepLabel([step("a", true), step("b", false)])).toBe("当前步骤 · b");
  });

  it("is null when nothing is open", () => {
    expect(stepLabel([step("a", true)])).toBeNull();
  });
});
