import { describe, expect, it } from "vite-plus/test";
import { overdueDays } from "../mappers";

describe("overdueDays", () => {
  it("counts overdue days from a given today", () => {
    expect(overdueDays("2026-10-18", "2026-10-20")).toBe(2);
    expect(overdueDays("2026-10-21", "2026-10-20")).toBe(0);
    expect(overdueDays(null, "2026-10-20")).toBe(0);
  });
});
