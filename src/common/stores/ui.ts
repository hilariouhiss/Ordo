import { createEffect, createRoot, createSignal } from "solid-js";

/** User-selectable theme preference. `system` follows the OS setting. */
export type ThemePreference = "light" | "dark" | "system";

/** Concrete theme actually applied to the document. */
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "ordo.theme";

const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";

function safeGetItem(key: string): string | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
  } catch {
    // Storage may be unavailable (e.g. private browsing); the choice still
    // applies for the current session via the in-memory signal.
  }
}

/** Whether the OS currently prefers a dark color scheme. */
export function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(DARK_MEDIA_QUERY).matches
  );
}

/** Resolve a preference into the concrete theme to apply. */
export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === "system") return systemPrefersDark() ? "dark" : "light";
  return preference;
}

function isThemePreference(value: string | null): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

function readInitialPreference(): ThemePreference {
  const stored = safeGetItem(THEME_STORAGE_KEY);
  return isThemePreference(stored) ? stored : "system";
}

const [preference, setPreference] = createSignal<ThemePreference>(readInitialPreference());
const [resolved, setResolved] = createSignal<ResolvedTheme>(resolveTheme(preference()));

/** Current preference signal: "light" | "dark" | "system". */
export const themePreference = preference;

/** Theme actually applied right now: "light" | "dark". */
export const resolvedTheme = resolved;

const [collapsed, setCollapsed] = createSignal(false);

/** Whether the app sidebar is collapsed to icon-only mode (in-memory only). */
export const sidebarCollapsed = collapsed;

/** Persist and apply a new theme preference. */
export function setTheme(next: ThemePreference): void {
  setPreference(next);
  safeSetItem(THEME_STORAGE_KEY, next);
}

/** Toggle the app sidebar between expanded and icon-only modes. */
export function toggleSidebar(): void {
  setCollapsed((value) => !value);
}

function applyResolvedTheme(theme: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
  // The canvas colour the pre-bundle script in `index.html` sets is re-applied
  // here so a theme switch keeps both in step. Same two values, same reason it
  // is a CSSOM write rather than a stylesheet rule (`index.html`).
  document.documentElement.style.background = theme === "dark" ? "#191a1c" : "#f7f8f9";
}

createRoot(() => {
  // Keep `resolvedTheme` in sync with the preference.
  createEffect(() => setResolved(resolveTheme(preference())));

  // Apply the resolved theme to the document.
  createEffect(() => applyResolvedTheme(resolved()));
});

// Follow live OS changes while the preference is "system".
if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
  window.matchMedia(DARK_MEDIA_QUERY).addEventListener("change", (event) => {
    if (preference() === "system") setResolved(event.matches ? "dark" : "light");
  });
}
