import { describe, expect, it } from "vitest";
import {
  COMPLEXITY_OPTIONS,
  complexityFromOption,
  complexityLabel,
  complexityOptionValue,
} from "../complexity";

describe("complexity vocabulary", () => {
  it("round-trips every option through its sentinel value", () => {
    for (const option of COMPLEXITY_OPTIONS) {
      expect(complexityOptionValue(complexityFromOption(option.value))).toBe(option.value);
    }
  });

  it("never uses the empty string as an option value", () => {
    // Kobalte's Select reads `""` as "nothing selected" and renders a blank
    // trigger, so 未评估 needs a real sentinel.
    expect(COMPLEXITY_OPTIONS.every((option) => option.value !== "")).toBe(true);
  });

  it("labels only real estimates", () => {
    expect(complexityLabel(3)).toBe("复杂度 3");
    expect(complexityLabel(null)).toBeNull();
    expect(complexityLabel(undefined)).toBeNull();
  });
});
