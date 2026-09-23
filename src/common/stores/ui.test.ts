import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveTheme,
  setTheme,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  SIDEBAR_WIDTH_STORAGE_KEY,
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

describe("sidebar width persistence", () => {
  /*
   * The width has to survive a restart (R10), and a stored value nobody can
   * still produce — hand-edited, or written by an older build with different
   * bounds — must not hand the shell a rail the handle could never show.
   */
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function freshStore(stored: string | null): Promise<typeof import("./ui")> {
    vi.stubGlobal("localStorage", { getItem: vi.fn(() => stored), setItem: vi.fn() });
    vi.resetModules();
    return import("./ui");
  }

  it("seeds from storage", async () => {
    const store = await freshStore("260");
    expect(store.sidebarWidth()).toBe(260);
  });

  it("clamps a stored value into the allowed band", async () => {
    const store = await freshStore("9999");
    expect(store.sidebarWidth()).toBe(SIDEBAR_WIDTH_MAX);
  });

  it("falls back to the default when storage holds nothing usable", async () => {
    const store = await freshStore("not-a-number");
    expect(store.sidebarWidth()).toBe(SIDEBAR_WIDTH_DEFAULT);
  });

  it("rounds, clamps and persists what the resize paths write", async () => {
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { getItem: vi.fn(() => null), setItem });
    vi.resetModules();
    const store = await import("./ui");

    store.setSidebarWidth(320.6);
    expect(store.sidebarWidth()).toBe(321);
    expect(setItem).toHaveBeenCalledWith(SIDEBAR_WIDTH_STORAGE_KEY, "321");

    store.setSidebarWidth(SIDEBAR_WIDTH_MIN - 500);
    expect(store.sidebarWidth()).toBe(SIDEBAR_WIDTH_MIN);
    expect(setItem).toHaveBeenLastCalledWith(SIDEBAR_WIDTH_STORAGE_KEY, String(SIDEBAR_WIDTH_MIN));
  });
});

describe("the theme is mirrored onto the native chrome", () => {
  /*
   * The webview can theme itself with `colorScheme`, but the frame, the title
   * bar, the tray and the taskbar are all drawn outside it — so the app theme
   * has to reach the backend. That is `app:setTheme`, and nothing type-checks
   * the string: a rename on either side compiles, runs, and silently leaves the
   * frame on the previous theme.
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

  it("takes the OS theme from the backend and follows what it pushes", async () => {
    // The page's media query is not the OS theme: setting the window theme makes
    // tauri re-pin the webview's color scheme to it, so the query reports the
    // app's own last write. Here the page says light and the backend says dark —
    // the backend is right.
    const invoke = vi.fn(async (command: string) =>
      command === "app:systemTheme" ? "dark" : undefined,
    );
    vi.doMock("@tauri-apps/api/core", () => ({ invoke }));
    let pushed: ((event: { payload: unknown }) => void) | undefined;
    vi.doMock("@tauri-apps/api/event", () => ({
      listen: async (_: string, handler: (event: { payload: unknown }) => void) => {
        pushed = handler;
        return () => {};
      },
    }));
    vi.resetModules();
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
    vi.stubGlobal("window", {
      matchMedia: () => ({ matches: false, addEventListener: () => {} }),
    });

    const store = await import("./ui");
    expect(store.themePreference(), "the default preference is 'system'").toBe("system");
    await vi.waitFor(() => expect(store.resolvedTheme()).toBe("dark"));

    // And a change the OS makes reaches the page the same way, with no media
    // query involved.
    pushed?.({ payload: "light" });
    await vi.waitFor(() => expect(store.resolvedTheme()).toBe("light"));

    vi.doUnmock("@tauri-apps/api/core");
    vi.doUnmock("@tauri-apps/api/event");
    vi.unstubAllGlobals();
  });

  it("never listens to the page's own color scheme", async () => {
    /*
     * The regression this pins. A listener on `prefers-color-scheme` reacts to
     * the app's own writes — `set_theme` re-pins the webview's scheme and fires a
     * change event — so it wrote the theme again, and the window flickered in a
     * loop until the values happened to agree. Nothing in the store may
     * subscribe to that query.
     */
    const invoke = vi.fn().mockResolvedValue(undefined);
    vi.doMock("@tauri-apps/api/core", () => ({ invoke }));
    vi.resetModules();
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
    const subscriptions: string[] = [];
    vi.stubGlobal("window", {
      matchMedia: (query: string) => ({
        matches: false,
        addEventListener: (type: string) => subscriptions.push(`${query}:${type}`),
      }),
    });

    const store = await import("./ui");
    store.setTheme("dark");
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("app:setTheme", { theme: "dark" }),
    );
    expect(subscriptions, "the store subscribed to a media query").toEqual([]);

    vi.doUnmock("@tauri-apps/api/core");
    vi.unstubAllGlobals();
  });

  it("follows a preference the other window changed", async () => {
    // Both windows run this store. The quick-add one loads once and keeps its own
    // copy of the preference, so without this the capture field would render the
    // theme the app just left — and, worse, could push it back at the frame.
    const invoke = vi.fn().mockResolvedValue(undefined);
    vi.doMock("@tauri-apps/api/core", () => ({ invoke }));
    vi.resetModules();
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
    let onStorage: ((event: { key: string; newValue: string | null }) => void) | undefined;
    vi.stubGlobal("window", {
      matchMedia: () => ({ matches: false, addEventListener: () => {} }),
      addEventListener: (type: string, handler: (event: never) => void) => {
        if (type === "storage") onStorage = handler as typeof onStorage;
      },
    });

    const store = await import("./ui");
    expect(store.themePreference()).toBe("system");

    onStorage?.({ key: THEME_STORAGE_KEY, newValue: "dark" });
    expect(store.themePreference(), "the other window's choice did not arrive").toBe("dark");
    expect(store.resolvedTheme()).toBe("dark");

    vi.doUnmock("@tauri-apps/api/core");
    vi.unstubAllGlobals();
  });

  it("names the commands the backend actually registers", () => {
    // Belt and braces: the Rust side spells the same names, and a mismatch would
    // only show up by looking at the tray or the taskbar.
    const rust = readFileSync(join(process.cwd(), "src-tauri", "src", "icons.rs"), "utf8");
    expect(rust).toContain('rename = "app:setTheme"');
    expect(rust).toContain('rename = "app:systemTheme"');
    expect(rust).toContain('SYSTEM_THEME_EVENT: &str = "app:systemThemeChanged"');
    const signature = rust.slice(rust.indexOf("pub fn set_theme"));
    expect(signature).toContain("theme: String");
    // The app theme and the OS theme travel separately: one command each, and
    // `app:setTheme` must not grow a second theme again.
    expect(signature.slice(0, signature.indexOf("}"))).not.toContain("system");
  });
});
