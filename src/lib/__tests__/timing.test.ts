import inverseCases from "./timing-inverse-cases.json";
import cases from "./timing-cases.json";
import { describe, expect, it } from "vite-plus/test";
import {
  effortForFinish,
  finishForEffort,
  timingAnchor,
  workdayOnOrAfter,
  workdayOnOrBefore,
} from "../timing";

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

/**
 * The same inverse examples run in `services/timing.rs`, so editing a finish date in
 * the sheet and storing it on save cannot drift apart.
 */
describe("the shared finish-to-effort examples", () => {
  it("matches the table the backend tests use", () => {
    for (const each of inverseCases) {
      const effort = effortForFinish(timingAnchor(each.today, each.start), each.finish);
      expect(effort, JSON.stringify(each)).toBe(each.effort);
    }
  });
});

describe("effortForFinish", () => {
  it("counts whole workdays from the anchor through the finish", () => {
    expect(effortForFinish("2026-10-21", "2026-10-21")).toBe(480);
    expect(effortForFinish("2026-10-21", "2026-10-23")).toBe(1440);
    expect(effortForFinish("2026-10-23", "2026-10-26")).toBe(960);
  });

  it("refuses a finish before the anchor or beyond sixty workdays", () => {
    expect(effortForFinish("2026-10-21", "2026-10-20")).toBeNull();
    expect(effortForFinish("2026-10-21", "2027-02-01")).toBeNull();
  });
});

describe("workdayOnOrAfter", () => {
  it("keeps a weekday and rolls a weekend to Monday", () => {
    expect(workdayOnOrAfter("2026-10-21")).toBe("2026-10-21");
    expect(workdayOnOrAfter("2026-10-24")).toBe("2026-10-26");
    expect(workdayOnOrAfter("2026-10-25")).toBe("2026-10-26");
  });
});

describe("workdayOnOrBefore", () => {
  it("keeps a weekday and rolls a weekend back to Friday", () => {
    expect(workdayOnOrBefore("2026-10-23")).toBe("2026-10-23");
    expect(workdayOnOrBefore("2026-10-24")).toBe("2026-10-23");
    expect(workdayOnOrBefore("2026-10-25")).toBe("2026-10-23");
    expect(workdayOnOrBefore("2026-10-26")).toBe("2026-10-26");
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
