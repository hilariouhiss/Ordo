import { describe, expect, it } from "vite-plus/test";
import { isImeEnter } from "../keys";

describe("isImeEnter", () => {
  it("ignores the Enter that commits an IME candidate", () => {
    expect(isImeEnter({ isComposing: true } as KeyboardEvent)).toBe(true);
    expect(isImeEnter({ isComposing: false, keyCode: 229 } as KeyboardEvent)).toBe(true);
  });

  it("accepts a plain Enter", () => {
    expect(isImeEnter({ isComposing: false, keyCode: 13 } as KeyboardEvent)).toBe(false);
  });
});
