export type ThemePref = "light" | "dark" | "system";
export type AppliedTheme = "light" | "dark";
export type ThemeMode = "work" | "personal";
/** The daisyUI palette painted on the page. */
export type ThemeName = "soft" | "soft-dark" | "personal" | "personal-dark";

/** The part of the Tauri window the theme code needs, so tests can fake it. */
export interface ThemeWindow {
  setTheme(theme: AppliedTheme | null): Promise<void>;
  theme(): Promise<AppliedTheme | null>;
}

/** The theme to paint: the explicit choice, or whatever the system asks for. */
export function resolveTheme(pref: string | null | undefined, systemDark: boolean): AppliedTheme {
  if (pref === "light" || pref === "dark") return pref;
  return systemDark ? "dark" : "light";
}

/** One palette per mode and brightness, so the two worlds never share a surface. */
export function themeName(brightness: AppliedTheme, mode: ThemeMode): ThemeName {
  if (mode === "personal") return brightness === "dark" ? "personal-dark" : "personal";
  return brightness === "dark" ? "soft-dark" : "soft";
}

export function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * The system theme. Setting a window theme also pins the webview's
 * `prefers-color-scheme` to it (wry calls SetPreferredColorScheme), so clear the
 * override first and let the window answer; on Windows it reads that from the OS.
 */
export async function systemTheme(
  win: ThemeWindow | null,
  mediaDark: boolean,
): Promise<AppliedTheme> {
  if (!win) return mediaDark ? "dark" : "light";
  await win.setTheme(null);
  const theme = await win.theme();
  if (theme === "light" || theme === "dark") return theme;
  return mediaDark ? "dark" : "light";
}

/**
 * Paints the page. The native frame is set by the caller, since pinning it changes the media
 * query. After the first paint a change goes through a view transition, so theme changes
 * cross-fade instead of snapping.
 */
export function applyTheme(name: ThemeName): void {
  const html = document.documentElement;
  const paint = () => {
    html.dataset.theme = name;
  };
  const changing = html.dataset.theme !== undefined && html.dataset.theme !== name;
  if (changing && !reducedMotion() && typeof document.startViewTransition === "function") {
    document.startViewTransition(paint);
    return;
  }
  paint();
}

/** Motion sickness wins over the cross-fade; the theme still switches. */
function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
