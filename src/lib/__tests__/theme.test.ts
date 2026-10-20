import { describe, expect, it } from "vite-plus/test";
import { resolveTheme } from "../theme";

describe("resolveTheme", () => {
  it("follows the setting when it names a theme", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("follows the system when the setting says so", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("falls back to the system for a missing or unknown value", () => {
    expect(resolveTheme(undefined, true)).toBe("dark");
    expect(resolveTheme(null, false)).toBe("light");
    expect(resolveTheme("purple", true)).toBe("dark");
  });
});
