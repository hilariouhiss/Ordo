import { Monitor, Moon, Sun } from "lucide-solid";
import { setTheme, themePreference, type ThemePreference } from "../stores/ui";

const PREFERENCES: ThemePreference[] = ["light", "dark", "system"];

const LABELS: Record<ThemePreference, string> = {
  light: "浅色",
  dark: "深色",
  system: "跟随系统",
};

function ThemeIcon(props: { preference: ThemePreference }) {
  // Conditional JSX (not an imperative `if` in the component body): the
  // component function only runs once, so the branch must be a reactive
  // expression to swap icons when the preference changes.
  return (
    <>
      {props.preference === "dark" ? (
        <Moon size={16} aria-hidden="true" />
      ) : props.preference === "light" ? (
        <Sun size={16} aria-hidden="true" />
      ) : (
        <Monitor size={16} aria-hidden="true" />
      )}
    </>
  );
}

type ThemeToggleProps = {
  /** Merged onto the button, replacing the default icon-button styling. */
  class?: string;
  /** Show the current theme name next to the icon (sidebar nav style). */
  showLabel?: boolean;
};

/**
 * Cycles light -> dark -> system. Renders as a compact icon button by default;
 * pass `class` + `showLabel` for the sidebar nav variant.
 */
export function ThemeToggle(props: ThemeToggleProps = {}) {
  const next = () =>
    PREFERENCES[(PREFERENCES.indexOf(themePreference()) + 1) % PREFERENCES.length];

  return (
    <button
      type="button"
      class={`flex items-center transition-colors ${
        props.class ??
        "size-9 justify-center rounded-md border border-border bg-surface text-foreground shadow-sm hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      }`}
      aria-label={`当前主题：${LABELS[themePreference()]}，点击切换`}
      title={`主题：${LABELS[themePreference()]}（点击切换）`}
      onClick={() => setTheme(next())}
    >
      <ThemeIcon preference={themePreference()} />
      {props.showLabel && <span>{LABELS[themePreference()]}</span>}
    </button>
  );
}
