import { reactive } from "vue";
import { askNotice } from "../lib/dialog";
import { errorText, t } from "../lib/i18n";

/** How long the bar waits before the undo is gone. */
export const UNDO_MS = 8000;

export function createUndoVM() {
  const state = reactive({
    entry: null as { message: string } | null,
    /** Bumped after a successful undo so the open page reloads its list. */
    revision: 0,
    busy: false,
  });
  let action: (() => Promise<void>) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function clearTimer(): void {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  }

  /** A new action replaces the old one; only the latest can be undone. */
  function pushUndo(message: string, run: () => Promise<void>): void {
    clearTimer();
    action = run;
    state.entry = { message };
    timer = setTimeout(() => {
      timer = null;
      action = null;
      state.entry = null;
    }, UNDO_MS);
  }

  function dismiss(): void {
    clearTimer();
    action = null;
    state.entry = null;
  }

  async function undo(): Promise<void> {
    const run = action;
    if (!run || state.busy) return;
    state.busy = true;
    dismiss();
    try {
      await run();
      state.revision += 1;
    } catch (e) {
      void askNotice(t("common.actionFailed"), errorText(e));
    } finally {
      state.busy = false;
    }
  }

  return { state, pushUndo, undo, dismiss };
}

export const undoVM = createUndoVM();
