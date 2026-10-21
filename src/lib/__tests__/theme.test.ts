import { describe, expect, it } from "vite-plus/test";
import { resolveTheme, systemTheme, type ThemeWindow } from "../theme";

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

describe("systemTheme", () => {
  it("clears the window override before asking for the OS theme", async () => {
    // Setting a window theme pins the webview's prefers-color-scheme to it, so the
    // media query cannot answer this; the window reports the OS once cleared.
    let pinned: "light" | "dark" | null = "light";
    const win: ThemeWindow = {
      setTheme: async (theme) => {
        pinned = theme;
      },
      theme: async () => pinned ?? "dark",
    };

    expect(await systemTheme(win, false)).toBe("dark");
  });

  it("falls back to the media query without a Tauri window", async () => {
    expect(await systemTheme(null, true)).toBe("dark");
    expect(await systemTheme(null, false)).toBe("light");
  });

  it("falls back to the media query when the window reports no theme", async () => {
    const win: ThemeWindow = {
      setTheme: async () => {},
      theme: async () => null,
    };
    expect(await systemTheme(win, true)).toBe("dark");
    expect(await systemTheme(win, false)).toBe("light");
  });
});
