import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveTheme,
  setTheme,
  THEME_STORAGE_KEY,
  themePreference,
} from "./ui";

function stubSystemDarkPreference(matches: boolean): void {
  vi.stubGlobal("window", { matchMedia: () => ({ matches }) });
}

describe("resolveTheme", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns explicit preferences unchanged", () => {
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
  });

  it("follows the system preference", () => {
    stubSystemDarkPreference(true);
    expect(resolveTheme("system")).toBe("dark");

    stubSystemDarkPreference(false);
    expect(resolveTheme("system")).toBe("light");
  });
});

describe("theme preference persistence", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists the choice and updates the signal", () => {
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { getItem: vi.fn(() => null), setItem });

    setTheme("dark");

    expect(themePreference()).toBe("dark");
    expect(setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, "dark");
  });
});
