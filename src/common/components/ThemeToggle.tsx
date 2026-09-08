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

/**
 * Cycles light -> dark -> system. Temporary entry point on the scaffold page;
 * the settings page (M6) will expose the full switcher.
 */
export function ThemeToggle() {
  const next = () =>
    PREFERENCES[(PREFERENCES.indexOf(themePreference()) + 1) % PREFERENCES.length];

  return (
    <button
      type="button"
      class="inline-flex size-9 items-center justify-center rounded-md border border-border bg-surface text-foreground shadow-sm transition-colors duration-200 hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      aria-label={`当前主题：${LABELS[themePreference()]}，点击切换`}
      title={`主题：${LABELS[themePreference()]}（点击切换）`}
      onClick={() => setTheme(next())}
    >
      <ThemeIcon preference={themePreference()} />
    </button>
  );
}
