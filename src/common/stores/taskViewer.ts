/**
 * Global "task viewer" UI state (§2.2: dialog state lives in `common/stores/`).
 *
 * Records which task the user jumped to from outside the task views (e.g. a
 * search hit). The viewer dialogs themselves are hosted by the app layer
 * (`app/TaskViewer.tsx`), which composes task-feature UI — features only
 * touch this store, keeping features from importing each other.
 */

import { createSignal } from "solid-js";

const [focusedTaskId, setFocusedTaskId] = createSignal<string | null>(null);

/** Reactive id of the task shown in the viewer; `null` when closed. */
export { focusedTaskId };

/** Opens the task viewer for `taskId` (swap to another id while open is fine). */
export function openTaskViewer(taskId: string): void {
  setFocusedTaskId(taskId);
}

export function closeTaskViewer(): void {
  setFocusedTaskId(null);
}
