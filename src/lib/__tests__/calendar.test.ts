import { describe, expect, it } from "vite-plus/test";
import { formatDateInput, monthMatrix, monthOf, parseDateInput, shiftMonth } from "../calendar";

describe("monthOf", () => {
  it("maps an ISO date to a zero-based month", () => {
    expect(monthOf("2026-10-22")).toEqual({ year: 2026, month: 9 });
  });
});

describe("shiftMonth", () => {
  it("wraps across years", () => {
    expect(shiftMonth({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 });
    expect(shiftMonth({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 });
    expect(shiftMonth({ year: 2026, month: 5 }, -7)).toEqual({ year: 2025, month: 10 });
  });
});

describe("monthMatrix", () => {
  it("starts on Monday and pads six weeks", () => {
    const days = monthMatrix(2026, 9);
    expect(days).toHaveLength(42);
    expect(days.slice(0, 3)).toEqual([null, null, null]);
    expect(days[3]).toBe("2026-10-01");
    expect(days.filter(Boolean)).toHaveLength(31);
    expect(days[33]).toBe("2026-10-31");
    expect(days[34]).toBeNull();
  });

  it("leaves no leading blanks when the month starts on Monday", () => {
    const days = monthMatrix(2026, 5);
    expect(days[0]).toBe("2026-06-01");
  });

  it("keeps the leap day", () => {
    const days = monthMatrix(2024, 1);
    expect(days).toContain("2024-02-29");
    expect(days.filter(Boolean)).toHaveLength(29);
  });
});

describe("parseDateInput", () => {
  it("accepts ISO and slashed dates and pads them", () => {
    expect(parseDateInput("2026-10-22")).toBe("2026-10-22");
    expect(parseDateInput("2026/10/22")).toBe("2026-10-22");
    expect(parseDateInput(" 2026/1/5 ")).toBe("2026-01-05");
  });

  it("treats empty input as no date", () => {
    expect(parseDateInput("")).toBe("");
    expect(parseDateInput("   ")).toBe("");
  });

  it("rejects impossible or foreign formats", () => {
    expect(parseDateInput("2026-02-30")).toBeNull();
    expect(parseDateInput("2026-13-01")).toBeNull();
    expect(parseDateInput("22/10/2026")).toBeNull();
    expect(parseDateInput("2026-10")).toBeNull();
    expect(parseDateInput("abc")).toBeNull();
  });
});

describe("formatDateInput", () => {
  it("shows the stored date with slashes", () => {
    expect(formatDateInput("2026-01-05")).toBe("2026/01/05");
    expect(formatDateInput("")).toBe("");
  });
});
