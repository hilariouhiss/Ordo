import { isTauri } from "@tauri-apps/api/core";

export type ThemePref = "light" | "dark" | "system";
export type AppliedTheme = "light" | "dark";

/** The theme to paint: the explicit choice, or whatever the system asks for. */
export function resolveTheme(pref: string | null | undefined, systemDark: boolean): AppliedTheme {
  if (pref === "light" || pref === "dark") return pref;
  return systemDark ? "dark" : "light";
}

export function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Paints the page, and the native title bar Windows draws for it. */
export function applyTheme(theme: AppliedTheme): void {
  document.documentElement.dataset.theme = theme === "dark" ? "soft-dark" : "soft";
  if (isTauri()) {
    // Title bar and window frame follow the OS theme unless told otherwise.
    void import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => getCurrentWindow().setTheme(theme))
      .catch(() => {});
  }
}
