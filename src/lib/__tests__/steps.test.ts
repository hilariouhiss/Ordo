import { describe, expect, it } from "vite-plus/test";
import type { Step } from "../../model/types";
import { currentStep, stepLabel, stepsDone } from "../steps";

function step(id: string, done: boolean): Step {
  return { id, taskId: "t1", title: id, sortOrder: 0, done };
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

describe("stepLabel", () => {
  it("names the current step", () => {
    expect(stepLabel([step("a", true), step("b", false)])).toBe("当前步骤 · b");
  });

  it("is null when nothing is open", () => {
    expect(stepLabel([step("a", true)])).toBeNull();
  });
});
