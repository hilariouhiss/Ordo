import { describe, expect, it } from "vitest";
import { isoToLocalInputValue, localInputValueToIso } from "../datetime";

describe("datetime conversions", () => {
  it("round-trips a minute-precision UTC timestamp through local input format", () => {
    // Mid-January is far from every timezone's DST transition boundaries.
    const iso = "2026-01-15T01:30:00.000Z";

    const local = isoToLocalInputValue(iso);
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

    expect(localInputValueToIso(local)).toBe(iso);
  });

  it("maps null/empty/invalid inputs to empty and null", () => {
    expect(isoToLocalInputValue(null)).toBe("");
    expect(isoToLocalInputValue("")).toBe("");
    expect(isoToLocalInputValue("not-a-date")).toBe("");

    expect(localInputValueToIso("")).toBeNull();
    expect(localInputValueToIso("garbage")).toBeNull();
  });
});
