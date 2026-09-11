import { describe, expect, it } from "vitest";
import { describeRepeatRule, REPEAT_FREQ_OPTIONS } from "../repeat";
import type { RepeatRule } from "../types";

function rule(overrides: Partial<RepeatRule> = {}): RepeatRule {
  return { freq: "daily", interval: 1, paused: false, ...overrides };
}

describe("describeRepeatRule", () => {
  it("labels single-period rules without a number", () => {
    expect(describeRepeatRule(rule({ freq: "daily" }))).toBe("每天");
    expect(describeRepeatRule(rule({ freq: "weekly" }))).toBe("每周");
    expect(describeRepeatRule(rule({ freq: "monthly" }))).toBe("每月");
  });

  it("labels multi-period rules with the interval", () => {
    expect(describeRepeatRule(rule({ freq: "weekly", interval: 2 }))).toBe("每 2 周");
    expect(describeRepeatRule(rule({ freq: "monthly", interval: 3 }))).toBe("每 3 月");
  });

  it("appends the paused marker", () => {
    expect(describeRepeatRule(rule({ paused: true }))).toBe("每天（已暂停）");
  });

  it("offers a none option plus one per frequency", () => {
    expect(REPEAT_FREQ_OPTIONS.map((option) => option.value)).toEqual([
      "none",
      "daily",
      "weekly",
      "monthly",
    ]);
  });
});
