import cases from "./timing-cases.json";
import { describe, expect, it } from "vite-plus/test";
import { finishForEffort, timingAnchor, workdayOnOrAfter } from "../timing";

/**
 * The same examples run in `services/timing.rs`, so a change to the rule on one side
 * fails a test instead of letting the preview and the stored date drift apart.
 */
describe("the shared finish-date examples", () => {
  it("matches the table the backend tests use", () => {
    for (const each of cases) {
      const finish = finishForEffort(timingAnchor(each.today, each.start), each.effort);
      expect(finish, JSON.stringify(each)).toBe(each.finish);
    }
  });
});

describe("workdayOnOrAfter", () => {
  it("keeps a weekday and rolls a weekend to Monday", () => {
    expect(workdayOnOrAfter("2026-10-21")).toBe("2026-10-21");
    expect(workdayOnOrAfter("2026-10-24")).toBe("2026-10-26");
    expect(workdayOnOrAfter("2026-10-25")).toBe("2026-10-26");
  });
});

describe("finishForEffort", () => {
  it("ends a day of work on the anchor day", () => {
    expect(finishForEffort("2026-10-21", 60)).toBe("2026-10-21");
    expect(finishForEffort("2026-10-21", 480)).toBe("2026-10-21");
  });

  it("counts whole days from the anchor", () => {
    expect(finishForEffort("2026-10-21", 960)).toBe("2026-10-22");
    expect(finishForEffort("2026-10-21", 1200)).toBe("2026-10-23");
  });

  it("skips the weekend", () => {
    expect(finishForEffort("2026-10-23", 960)).toBe("2026-10-26");
    expect(finishForEffort("2026-10-24", 60)).toBe("2026-10-26");
  });

  it("treats a sub-hour estimate as one hour", () => {
    expect(finishForEffort("2026-10-21", 1)).toBe("2026-10-21");
  });
});

describe("timingAnchor", () => {
  it("starts today unless the task has a later start", () => {
    expect(timingAnchor("2026-10-21", null)).toBe("2026-10-21");
    expect(timingAnchor("2026-10-21", "2026-10-19")).toBe("2026-10-21");
    expect(timingAnchor("2026-10-21", "2026-10-23")).toBe("2026-10-23");
  });

  it("rolls a weekend start to Monday", () => {
    expect(timingAnchor("2026-10-21", "2026-10-24")).toBe("2026-10-26");
  });
});
