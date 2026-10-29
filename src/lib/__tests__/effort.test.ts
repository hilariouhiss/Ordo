import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  EFFORT_MAX_MINUTES,
  EFFORT_MIN_MINUTES,
  bestEffortUnit,
  effortAmountIn,
  formatEffort,
  parseEffortAmount,
  parseEffortText,
  splitEffort,
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

describe("bestEffortUnit", () => {
  it("uses the largest unit that leaves a whole or half number", () => {
    expect(bestEffortUnit(480)).toEqual({ amount: 1, unit: "days" });
    expect(bestEffortUnit(240)).toEqual({ amount: 0.5, unit: "days" });
    expect(bestEffortUnit(720)).toEqual({ amount: 1.5, unit: "days" });
    expect(bestEffortUnit(600)).toEqual({ amount: 10, unit: "hours" });
    expect(bestEffortUnit(90)).toEqual({ amount: 1.5, unit: "hours" });
    expect(bestEffortUnit(30)).toEqual({ amount: 0.5, unit: "hours" });
    expect(bestEffortUnit(150)).toEqual({ amount: 2.5, unit: "hours" });
    expect(bestEffortUnit(45)).toEqual({ amount: 45, unit: "minutes" });
    expect(bestEffortUnit(1)).toEqual({ amount: 1, unit: "minutes" });
    expect(bestEffortUnit(EFFORT_MAX_MINUTES)).toEqual({ amount: 60, unit: "days" });
  });
});

describe("effortAmountIn", () => {
  it("shows a duration in the chosen unit", () => {
    expect(effortAmountIn(960, "hours")).toBe("16");
    expect(effortAmountIn(90, "days")).toBe("0.1875");
    expect(effortAmountIn(240, "days")).toBe("0.5");
  });

  it("keeps enough precision to read back", () => {
    for (const minutes of [1, 7, 45, 90, 479, 240, 960, EFFORT_MAX_MINUTES]) {
      for (const unit of ["days", "hours", "minutes"] as const) {
        expect(parseEffortAmount(effortAmountIn(minutes, unit), unit)).toBe(minutes);
      }
    }
  });
});

describe("parseEffortAmount", () => {
  it("reads a decimal amount in the chosen unit", () => {
    expect(parseEffortAmount("0.5", "days")).toBe(240);
    expect(parseEffortAmount("0.5", "hours")).toBe(30);
    expect(parseEffortAmount("1.25", "hours")).toBe(75);
    expect(parseEffortAmount("2", "minutes")).toBe(2);
  });

  it("rounds to whole minutes", () => {
    expect(parseEffortAmount("0.1", "hours")).toBe(6);
    expect(parseEffortAmount("0.33", "hours")).toBe(20);
    expect(parseEffortAmount("0.001", "hours")).toBeNull();
  });

  it("rejects nonsense and out-of-range values", () => {
    expect(parseEffortAmount("", "hours")).toBeNull();
    expect(parseEffortAmount("  ", "hours")).toBeNull();
    expect(parseEffortAmount("abc", "hours")).toBeNull();
    expect(parseEffortAmount("0", "days")).toBeNull();
    expect(parseEffortAmount("-1", "hours")).toBeNull();
    expect(parseEffortAmount("100", "days")).toBeNull();
  });

  it("round-trips the normalized pair", () => {
    for (const minutes of [1, 15, 30, 45, 60, 90, 150, 240, 480, 600, 720, EFFORT_MAX_MINUTES]) {
      const value = bestEffortUnit(minutes);
      expect(parseEffortAmount(String(value.amount), value.unit)).toBe(minutes);
    }
  });
});
