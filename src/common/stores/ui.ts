import { createEffect, createRoot, createSignal } from "solid-js";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** User-selectable theme preference. `system` follows the OS setting. */
export type ThemePreference = "light" | "dark" | "system";

/** Concrete theme actually applied to the document. */
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "ordo.theme";

/** Sidebar width bounds, in px. The default is the width the rail shipped with
 * (`w-56`); the minimum keeps a row readable with its trailing ＋, the maximum
 * keeps the content area from being squeezed on a typical window. */
export const SIDEBAR_WIDTH_STORAGE_KEY = "ordo.sidebarWidth";
export const SIDEBAR_WIDTH_MIN = 192;
export const SIDEBAR_WIDTH_MAX = 448;
export const SIDEBAR_WIDTH_DEFAULT = 224;

const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";

/** Reads a stored preference, tolerating storage being unavailable (private
 * browsing). Exported because the update flow keeps its own preference the same
 * way (R15). */
export function safeGetItem(key: string): string | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Writes a stored preference; a failure leaves the caller's signal in charge. */
export function safeSetItem(key: string, value: string): void {
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

/*
 * The OS theme, as reported by the backend.
 *
 * NOT read from `prefers-color-scheme`, which is what this used to do. Setting
 * the window theme makes tauri re-pin the webview's WebView2 color scheme to
 * that theme (wry's `set_theme`), so the media query reports what this app last
 * wrote rather than what the OS is doing: reading it as the system theme fed our
 * own output back in as input. Worse, every write fires a change event in every
 * page, so a listener on it wrote the theme again — a loop, seen as the window
 * flickering. Rust reads the OS theme off a window it never pins and pushes it
 * here (`src-tauri/src/icons.rs`, DECISIONS M18).
 *
 * `null` means "not known yet": `systemPrefersDark` is the seed, correct until
 * the first pin, and the backend's answer replaces it.
 */
const [systemTheme, setSystemTheme] = createSignal<ResolvedTheme | null>(null);

/** Resolve a preference into the concrete theme to apply. */
export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === "system") {
    return systemTheme() ?? (systemPrefersDark() ? "dark" : "light");
  }
  return preference;
}

function isThemePreference(value: string | null): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

function readInitialPreference(): ThemePreference {
  const stored = safeGetItem(THEME_STORAGE_KEY);
  return isThemePreference(stored) ? stored : "system";
}

function clampSidebarWidth(value: number): number {
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(value)));
}

/** The stored width, clamped — a stale or hand-edited value must not hand the
 * shell a width the resize handle could never produce. */
function readInitialSidebarWidth(): number {
  const stored = Number(safeGetItem(SIDEBAR_WIDTH_STORAGE_KEY));
  return Number.isFinite(stored) ? clampSidebarWidth(stored) : SIDEBAR_WIDTH_DEFAULT;
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

const [width, setWidth] = createSignal(readInitialSidebarWidth());

/** The expanded sidebar's width in px (persisted; collapse is a separate state). */
export const sidebarWidth = width;

/** Persist and apply a new sidebar width. Out-of-range values clamp, so both
 * the drag and the keyboard path can write without pre-checking. */
export function setSidebarWidth(next: number): void {
  const clamped = clampSidebarWidth(next);
  setWidth(clamped);
  safeSetItem(SIDEBAR_WIDTH_STORAGE_KEY, String(clamped));
}

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
  document.documentElement.style.background = theme === "dark" ? "#0d0908" : "#f5f1ec";

  // Tell the native window too, or the title bar keeps whatever the system is
  // set to while the page next to it is the opposite — a black bar above a bone
  // window when the app is light and Windows is dark. `colorScheme` above does
  // not reach it: the frame is drawn by the window manager, not the webview.
  // Passing the *resolved* theme (not the preference) is the point — an
  // explicit in-app choice should beat the system setting here as well. The tray
  // and the taskbar are not ours to set: they follow the OS theme in Rust.
  void setWindowTheme(theme);
}

/**
 * Mirrors the app theme onto the native chrome: the frame, and the icon in it.
 *
 * Goes through `app:setTheme` rather than the webview's own window API because
 * the window's theme, its icon and the webview's own color scheme are three
 * settings that have to move together (see the loop this caused: DECISIONS M18).
 *
 * Only the main window sends it: the quick-add window renders this same store,
 * and a second page pushing a theme it resolved from its own copy of the
 * preference is how two windows end up fighting over the frame.
 *
 * Best-effort, like every other Tauri call in this codebase: under the plain
 * Vite dev server and in jsdom there is no backend to talk to, and that is not
 * an error worth surfacing.
 */
async function setWindowTheme(theme: ResolvedTheme): Promise<void> {
  if (isQuickAddWindow()) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("app:setTheme", { theme });
  } catch {
    // Not running in Tauri, or the window is gone. The page is themed already.
  }
}

/**
 * Whether this page is the small capture window.
 *
 * Outside a Tauri runtime — the plain Vite dev server, jsdom — there is no label
 * to read, and the main app is the only sensible assumption.
 */
function isQuickAddWindow(): boolean {
  try {
    return getCurrentWindow().label === "quick-add";
  } catch {
    return false;
  }
}

/** The theme names the backend sends and accepts; anything else is ignored. */
function asTheme(value: unknown): ResolvedTheme | null {
  return value === "dark" || value === "light" ? value : null;
}

/**
 * Takes the OS theme from the backend instead of from the media query.
 *
 * Subscribes first and asks second: a change landing between the two would be
 * dropped the other way round, and the answer is the more recent of the two
 * anyway. Both halves stand alone — in a browser there is no backend, and the
 * seed from `systemPrefersDark` is what the resolver falls back to.
 */
async function followSystemTheme(): Promise<void> {
  try {
    const { listen } = await import("@tauri-apps/api/event");
    await listen<unknown>("app:systemThemeChanged", (event) =>
      setSystemTheme(asTheme(event.payload)),
    );
  } catch {
    // No backend: the seed stands.
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    setSystemTheme(asTheme(await invoke("app:systemTheme")));
  } catch {
    // Same.
  }
}

createRoot(() => {
  // Keep `resolvedTheme` in sync with the preference — and with the OS theme,
  // which the backend pushes in.
  createEffect(() => setResolved(resolveTheme(preference())));

  // Apply the resolved theme to the document.
  createEffect(() => applyResolvedTheme(resolved()));
});

// The quick-add window is a second page on this same store, holding its own copy
// of the preference from its own load. A change made in the main window reaches
// it through storage, or the capture field renders the theme the app just left.
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("storage", (event) => {
    if (event.key === THEME_STORAGE_KEY && isThemePreference(event.newValue)) {
      setPreference(event.newValue);
    }
  });
}

void followSystemTheme();
