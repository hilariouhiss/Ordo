import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  EFFORT_MAX_MINUTES,
  EFFORT_MIN_MINUTES,
  formatEffort,
  parseEffortText,
  splitEffort,
  stepEffort,
  validEffort,
} from "../effort";
import { setLanguage } from "../i18n";

afterEach(() => setLanguage("zh"));

describe("formatEffort", () => {
  it("names days, hours and minutes", () => {
    expect(formatEffort(150)).toBe("2 小时 30 分");
    expect(formatEffort(480)).toBe("1 天");
    expect(formatEffort(600)).toBe("1 天 2 小时");
    expect(formatEffort(7)).toBe("7 分钟");
  });

  it("switches language", () => {
    setLanguage("en");
    expect(formatEffort(150)).toBe("2h 30m");
    expect(formatEffort(480)).toBe("1d");
    expect(formatEffort(45)).toBe("45m");
  });
});

describe("splitEffort", () => {
  it("splits a duration into days, hours and minutes", () => {
    expect(splitEffort(150)).toEqual({ days: 0, hours: 2, minutes: 30 });
    expect(splitEffort(600)).toEqual({ days: 1, hours: 2, minutes: 0 });
    expect(splitEffort(45)).toEqual({ days: 0, hours: 0, minutes: 45 });
  });
});

describe("parseEffortText", () => {
  it("reads the clock shape", () => {
    expect(parseEffortText("2:30")).toBe(150);
    expect(parseEffortText("0:07")).toBe(7);
  });

  it("reads hours, minutes and bare minutes", () => {
    expect(parseEffortText("1.5h")).toBe(90);
    expect(parseEffortText("2小时30分")).toBe(150);
    expect(parseEffortText("30m")).toBe(30);
    expect(parseEffortText("90")).toBe(90);
  });

  it("rejects nonsense and out-of-range values", () => {
    expect(parseEffortText("abc")).toBeNull();
    expect(parseEffortText("0")).toBeNull();
    expect(parseEffortText("481h")).toBeNull();
    expect(parseEffortText("")).toBeNull();
  });
});

describe("validEffort", () => {
  it("keeps one minute up to sixty days", () => {
    expect(validEffort(EFFORT_MIN_MINUTES)).toBe(true);
    expect(validEffort(EFFORT_MAX_MINUTES)).toBe(true);
    expect(validEffort(0)).toBe(false);
    expect(validEffort(EFFORT_MAX_MINUTES + 1)).toBe(false);
    expect(validEffort(1.5)).toBe(false);
  });
});

describe("stepEffort", () => {
  it("moves a quarter hour and clamps", () => {
    expect(stepEffort(480, 1)).toBe(495);
    expect(stepEffort(480, -1)).toBe(465);
    expect(stepEffort(EFFORT_MIN_MINUTES, -1)).toBe(EFFORT_MIN_MINUTES);
    expect(stepEffort(EFFORT_MAX_MINUTES, 1)).toBe(EFFORT_MAX_MINUTES);
  });
});
