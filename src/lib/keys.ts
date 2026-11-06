export function isImeEnter(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229;
}

/**
 * The in-app create shortcut: Ctrl+N for a task and Ctrl+Shift+N for a project.
 * Alt-only combinations are system keys (AltGr arrives as Ctrl+Alt) and holding
 * the key down must not stack modals.
 */
export function createShortcut(event: KeyboardEvent): "task" | "project" | null {
  if (event.repeat || event.isComposing) return null;
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  if (event.key.toLowerCase() !== "n") return null;
  return event.shiftKey ? "project" : "task";
}

/** The global search palette: Ctrl+K (or Super+K), no Alt/Shift, no repeats. */
export function searchShortcut(event: KeyboardEvent): boolean {
  if (event.repeat || event.isComposing) return false;
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return false;
  return event.key.toLowerCase() === "k";
}

/** The last-action undo: Ctrl+Z (or Super+Z), leaving Shift+Ctrl+Z free for redo. */
export function undoShortcut(event: KeyboardEvent): boolean {
  if (event.repeat || event.isComposing) return false;
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return false;
  return event.key.toLowerCase() === "z";
}

/** Text entry keeps its own Ctrl+Z; the app-wide undo must not steal it. */
export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  return (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    el.isContentEditable === true
  );
}

const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta"]);

/**
 * The accelerator a recording session should save, or null while it should keep
 * listening. Ctrl or Super is required: Alt-only combos are system keys (Alt+F4),
 * and a global Shift+letter would swallow that letter in every app.
 */
export function recordShortcut(event: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null;
  if (!event.ctrlKey && !event.metaKey) return null;
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Super");
  parts.push(event.key.length === 1 ? event.key.toUpperCase() : event.key);
  return parts.join("+");
}
