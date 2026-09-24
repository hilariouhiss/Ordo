/**
 * How many modal dialogs are open, as a reactive count (UI state → `common/stores/`,
 * per the boundary rules in `docs/ARCHITECTURE.md`§2.2–2.3).
 *
 * The auto-update flow waits for this before restarting the app: an installer
 * that fires while someone is filling in a dialog throws their input away. The
 * count is what the app knows for certain; asking the DOM for `[role=dialog]`
 * would depend on how Kobalte happens to render a dialog this version, and it
 * is not assertable in jsdom without a real dialog.
 */

import { createSignal } from "solid-js";

const [count, setCount] = createSignal(0);

/** Open modal dialogs right now. */
export const openDialogCount = count;

/**
 * Registers one dialog for its lifetime and returns the disposer that gives the
 * slot back. Call it as `onCleanup(registerDialog())` inside the dialog's own
 * component body, which is the mount: Kobalte keeps a closed dialog's subtree
 * unmounted, so mounting and closing are exactly a dialog's open and close.
 */
export function registerDialog(): () => void {
  setCount((open) => open + 1);
  return () => setCount((open) => Math.max(0, open - 1));
}

/** Test seam: forget every open dialog. */
export function resetDialogs(): void {
  setCount(0);
}
