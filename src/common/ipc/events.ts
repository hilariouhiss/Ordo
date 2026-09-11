/**
 * Backend → frontend event names (the mirror of `commands.ts`). The backend
 * emits these with `app.emit` (`src-tauri/src/scheduler.rs`); the frontend
 * subscribes via `listen` from `@tauri-apps/api/event`.
 */
export const EVENTS = {
  /** Payload: `Reminder` (`src-tauri/src/models.rs`), emitted per fired reminder. */
  reminderTriggered: "reminder:triggered",
  /** Payload: none; the global quick-add shortcut fired (`src-tauri/src/shortcut.rs`). */
  quickAdd: "quick-add:open",
} as const;
