import { reactive } from "vue";
import { aiEnrich, capture } from "../model/ipc";
import type { CaptureFields } from "../model/types";
import { appVM } from "./appVM";

export function createCaptureVM() {
  const state = reactive({
    draft: "",
    saved: false,
    saving: false,
  });

  /** Saves the line; `newProjectName` turns an unknown `#name` into a real project. */
  async function save(
    title: string,
    fields: CaptureFields,
    newProjectName: string | null,
    hide: () => void,
  ): Promise<boolean> {
    if (state.saving) return false;
    const text = title.trim();
    if (!text) return false;
    state.saving = true;
    try {
      const task = await capture(text, fields, newProjectName);
      if (newProjectName) void appVM.load().catch(() => {});
      void aiEnrich(task.id);
      state.saved = true;
      setTimeout(() => {
        state.saved = false;
        // A new draft means the user is typing the next task; hiding would interrupt it.
        if (!state.draft.trim()) hide();
      }, 800);
      return true;
    } finally {
      state.saving = false;
    }
  }

  return { state, save };
}
