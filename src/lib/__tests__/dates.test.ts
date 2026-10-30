import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  addDays,
  isWeekend,
  localDate,
  mondayOf,
  remainingWorkdays,
  shortDateTime,
  weekdayLabel,
  weekdayOf,
} from "../dates";
import { setLanguage } from "../i18n";

afterEach(() => setLanguage("zh"));

describe("addDays", () => {
  it("stays on the same local date for offset 0", () => {
    expect(addDays("2026-10-20", 0)).toBe("2026-10-20");
    expect(addDays("2026-10-20", 1)).toBe("2026-10-21");
    expect(addDays("2026-10-20", -21)).toBe("2026-09-29");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
});

describe("weekdays", () => {
  it("counts Monday to Sunday with Sunday as 0", () => {
    expect(weekdayOf("2026-10-19")).toBe(1);
    expect(weekdayOf("2026-10-20")).toBe(2);
    expect(weekdayOf("2026-10-25")).toBe(0);
    expect(weekdayOf("2026-01-01")).toBe(4);
  });

  it("labels the day in Chinese", () => {
    expect(weekdayLabel("2026-10-20")).toBe("周二");
    expect(weekdayLabel("2026-10-25")).toBe("周日");
    expect(weekdayLabel("2026-01-01")).toBe("周四");
  });

  it("labels the day in English", () => {
    setLanguage("en");
    expect(weekdayLabel("2026-10-20")).toBe("Tue");
    expect(weekdayLabel("2026-10-25")).toBe("Sun");
    expect(weekdayLabel("2026-01-01")).toBe("Thu");
  });

  it("calls Saturday and Sunday weekends", () => {
    expect(isWeekend("2026-10-23")).toBe(false);
    expect(isWeekend("2026-10-24")).toBe(true);
    expect(isWeekend("2026-10-25")).toBe(true);
    expect(isWeekend("2026-10-26")).toBe(false);
  });
});

describe("mondayOf", () => {
  it("returns the Monday of the week", () => {
    expect(mondayOf("2026-10-19")).toBe("2026-10-19");
    expect(mondayOf("2026-10-25")).toBe("2026-10-19");
    expect(mondayOf("2026-01-01")).toBe("2025-12-29");
  });
});

describe("localDate", () => {
  it("keeps the local calendar day of a timestamp", () => {
    expect(localDate(new Date(2026, 9, 20, 0, 30).toISOString())).toBe("2026-10-20");
  });
});

describe("remainingWorkdays", () => {
  it("lists today through Friday in the middle of the week", () => {
    expect(remainingWorkdays("2026-10-20")).toEqual([
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
    ]);
  });

  it("keeps only Friday on a Friday", () => {
    expect(remainingWorkdays("2026-10-23")).toEqual(["2026-10-23"]);
  });

  it("rolls the weekend to the next Monday through Friday", () => {
    const nextWeek = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"];
    expect(remainingWorkdays("2026-10-24")).toEqual(nextWeek);
    expect(remainingWorkdays("2026-10-25")).toEqual(nextWeek);
  });
});

describe("shortDateTime", () => {
  it("renders the local month, day, hour and minute", () => {
    expect(shortDateTime(new Date(2026, 9, 20, 9, 5).toISOString())).toBe("10/20 09:05");
  });

  it("returns an empty string when there is no stamp", () => {
    expect(shortDateTime(null)).toBe("");
    expect(shortDateTime("nope")).toBe("");
  });
});
