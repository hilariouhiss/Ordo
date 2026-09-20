import { readFileSync } from "node:fs";
import { join } from "node:path";
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

describe("the theme is mirrored onto the native chrome", () => {
  /*
   * The webview can theme itself with `colorScheme`, but the title bar, the tray
   * and the app icon are all drawn outside it — so the resolved theme has to
   * reach the backend. That is `app:setTheme`, and nothing type-checks the
   * string: a rename on either side compiles, runs, and silently leaves the
   * frame and tray on the previous theme.
   */
  it("invokes app:setTheme with the resolved theme, not the preference", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    vi.doMock("@tauri-apps/api/core", () => ({ invoke }));
    vi.resetModules();
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
    vi.stubGlobal("window", {
      matchMedia: () => ({ matches: false, addEventListener: () => {} }),
    });

    const store = await import("./ui");
    await vi.waitFor(() => expect(invoke).toHaveBeenCalled());
    store.setTheme("dark");
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("app:setTheme", { theme: "dark" }),
    );

    vi.doUnmock("@tauri-apps/api/core");
    vi.unstubAllGlobals();
  });

  it("names the command the backend actually registers", () => {
    // Belt and braces: the Rust side spells the same string, and a mismatch
    // would only show up by looking at the title bar.
    const rust = readFileSync(join(process.cwd(), "src-tauri", "src", "icons.rs"), "utf8");
    expect(rust).toContain('rename = "app:setTheme"');
  });
});
