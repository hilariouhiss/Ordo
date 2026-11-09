export type ThemePref = "light" | "dark" | "system";
export type AppliedTheme = "light" | "dark";

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
 * query. After the first paint a change goes through a view transition, so light/dark
 * cross-fades instead of snapping.
 */
export function applyTheme(theme: AppliedTheme): void {
  const html = document.documentElement;
  const name = theme === "dark" ? "soft-dark" : "soft";
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
