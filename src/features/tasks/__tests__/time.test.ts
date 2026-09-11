import { describe, expect, it } from "vitest";
import { formatClock, formatDuration, fromLocalInputValue, toLocalInputValue } from "../time";

describe("formatDuration", () => {
  it("rounds sub-minute lengths down to seconds", () => {
    expect(formatDuration(0)).toBe("0 秒");
    expect(formatDuration(45)).toBe("45 秒");
    expect(formatDuration(59)).toBe("59 秒");
  });

  it("shows whole minutes below an hour", () => {
    expect(formatDuration(60)).toBe("1 分钟");
    expect(formatDuration(1800)).toBe("30 分钟");
  });

  it("shows hours, dropping a zero minute part", () => {
    expect(formatDuration(3600)).toBe("1 小时");
    expect(formatDuration(7200)).toBe("2 小时");
    expect(formatDuration(9000)).toBe("2 小时 30 分");
  });
});

describe("formatClock", () => {
  it("renders a zero-padded HH:MM:SS readout", () => {
    expect(formatClock(0)).toBe("00:00:00");
    expect(formatClock(90)).toBe("00:01:30");
    expect(formatClock(3661)).toBe("01:01:01");
    expect(formatClock(36000)).toBe("10:00:00");
  });
});

describe("datetime-local conversion", () => {
  it("round-trips a local instant", () => {
    const date = new Date(2026, 8, 9, 9, 5);
    expect(toLocalInputValue(date)).toBe("2026-09-09T09:05");
    expect(fromLocalInputValue("2026-09-09T09:05").getTime()).toBe(date.getTime());
  });
});
