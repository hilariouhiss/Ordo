import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Platform conformance (Q-03). Everything here is something the app has to get
 * right on all three targets but that only one of them can be *run* from this
 * checkout, so it is asserted mechanically instead: bundle targets and icons,
 * the capability file's window list, the one place each platform branch lives,
 * and the prefixed property WebKit needs. Running the app on macOS and Linux is
 * still a human job — the checklist is in ARCHITECTURE §6.3.
 */

// Vitest runs from the project root, so the tree is resolved from there.
const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const tauriConfig = JSON.parse(read("src-tauri/tauri.conf.json")) as {
  app: { windows: { label?: string }[] };
  bundle: { active: boolean; targets: string; icon: string[] };
};
const capabilities = JSON.parse(read("src-tauri/capabilities/default.json")) as {
  windows: string[];
  permissions: string[];
};
const libSource = read("src-tauri/src/lib.rs");
const cargoToml = read("src-tauri/Cargo.toml");
const css = read("src/index.css");
const dialogSource = read("src/common/components/dialog.tsx");

describe("platform conformance", () => {
  it("bundles for all three targets from one icon set", () => {
    // "all" is what produces nsis/msi, app/dmg and deb/rpm/appimage per platform.
    expect(tauriConfig.bundle.active).toBe(true);
    expect(tauriConfig.bundle.targets).toBe("all");
    // .ico for Windows, .icns for macOS, PNGs for Linux (and the Linux tray).
    const icons = tauriConfig.bundle.icon.join(" ");
    expect(icons).toContain("icon.ico");
    expect(icons).toContain("icon.icns");
    expect(icons).toContain("128x128.png");
  });

  it("watches the icon directory, so a regenerated icon reaches the binary", () => {
    /*
     * The icons are embedded into the executable at compile time, and
     * `tauri_build::build()` only emits `rerun-if-changed` for
     * `tauri.conf.json` and `capabilities/`. Without this line, running
     * `tauri icon …` updates the files on disk and leaves the running binary —
     * and therefore the title bar and taskbar — on the previous artwork until
     * something unrelated invalidates the build.
     */
    expect(read("src-tauri/build.rs")).toMatch(/rerun-if-changed=icons/);
  });

  it("authorizes both windows, which is per-window rather than per-platform", () => {
    // The quick-add window silently loses every IPC call if it is missing here,
    // and the tray's 显示 entry has to be able to hide/show `main`.
    expect(capabilities.windows).toContain("main");
    expect(capabilities.windows).toContain("quick-add");
  });

  it("authorizes the theme and icon commands, which the frame depends on", () => {
    /*
     * `applyResolvedTheme` calls `app:setTheme`, which mirrors the theme onto the
     * native window, the tray and the app icon. Two things can silently break it:
     *
     *  - `set_theme` is NOT part of `core:window:default` (unlike `theme` and
     *    `is_decorated`), and neither is `set_icon`, so both have to be declared
     *    or the call rejects, the store swallows it, and the only symptom is a
     *    title bar and tray that keep the previous theme's artwork.
     *  - The command has to be registered, or the frontend reaches nothing.
     *
     * Both failures are invisible by design, so they are asserted here.
     */
    for (const permission of ["core:window:allow-set-theme", "core:window:allow-set-icon"]) {
      expect(capabilities.permissions, `${permission} missing`).toContain(permission);
    }
    expect(read("src-tauri/src/lib.rs")).toMatch(/icons::set_theme/);
    expect(
      read("src/common/stores/ui.ts"),
      "the store must actually invoke it, or the permission is dead weight",
    ).toMatch(/invoke\("app:setTheme"/);
  });

  it("keeps one instance, so a second launch cannot open the same database twice", () => {
    /*
     * The app lives in the tray, so launching it again (shortcut, dock, start
     * menu) is the normal way a user "reopens" it. Without this the second
     * process opens the same SQLite file — `busy_timeout` is deliberately unset
     * (QA-11), so two writers means "database is locked" on whichever write
     * lands second.
     */
    expect(cargoToml).toContain("tauri-plugin-single-instance");
    expect(libSource).toContain("tauri_plugin_single_instance::init");
  });

  it("brings the window back when macOS re-opens the app", () => {
    /*
     * On macOS, closing the window parks the app in the tray and clicking the
     * dock icon then re-activates it: without a `Reopen` handler nothing
     * happens and the window is only reachable from the tray menu.
     */
    expect(libSource).toContain("RunEvent::Reopen");
  });

  it("blurs the dialog scrim on WebKit as well as Chromium", () => {
    /*
     * `backdrop-blur-*` emits the unprefixed property only, and WebKit — both
     * macOS and the Linux webview — needs `-webkit-backdrop-filter` until
     * Safari 18. The utility carries both spellings.
     */
    expect(css).toContain("-webkit-backdrop-filter");
    expect(dialogSource).toContain("scrim-blur");
  });
});
