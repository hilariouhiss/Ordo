import { afterEach, describe, expect, it } from "vite-plus/test";
import { setLanguage } from "../i18n";
import { ruleSummary, weekdayName } from "../rules";

afterEach(() => setLanguage("zh"));

describe("weekdayName", () => {
  it("maps ISO weekdays", () => {
    expect(weekdayName(1)).toBe("周一");
    expect(weekdayName(7)).toBe("周日");
  });
});

describe("ruleSummary", () => {
  it("names one day and its time", () => {
    expect(ruleSummary({ weekdays: [4], at: "09:00" })).toBe("周四 09:00");
  });

  it("joins several days in week order", () => {
    expect(ruleSummary({ weekdays: [5, 1], at: "13:30" })).toBe("周一、周五 13:30");
  });

  it("switches language", () => {
    setLanguage("en");
    expect(ruleSummary({ weekdays: [4], at: "09:00" })).toBe("Thu at 09:00");
    expect(ruleSummary({ weekdays: [5, 1], at: "13:30" })).toBe("Mon, Fri at 13:30");
  });
});
