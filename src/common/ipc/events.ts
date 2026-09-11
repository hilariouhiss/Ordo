/**
 * Event names shared across the webview boundary. The backend emits
 * `reminderTriggered` and `quickAdd` with `app.emit` / `app.emit_to`
 * (`src-tauri/src/scheduler.rs`, `src-tauri/src/shortcut.rs`); the frontend
 * subscribes via `listen` from `@tauri-apps/api/event`. `taskCreated` runs the
 * other way, window to window (see `src/app/QuickAddWindow.tsx`).
 */
export const EVENTS = {
  /** Payload: `Reminder` (`src-tauri/src/models.rs`), emitted per fired reminder. */
  reminderTriggered: "reminder:triggered",
  /**
   * Payload: none; the global shortcut surfaced the quick-add window. Sent to
   * that window only, which clears its field and focuses the input.
   */
  quickAdd: "quick-add:open",
  /**
   * Payload: none; the quick-add window filed a task. Each window has its own
   * store, so the main window reloads from the backend on this.
   */
  taskCreated: "task:created",
} as const;
