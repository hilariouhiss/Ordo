import { reactive } from "vue";
import { aiEnrich, capture } from "../model/ipc";
import type { CaptureFields } from "../model/types";

export function createCaptureVM() {
  const state = reactive({
    draft: "",
    saved: false,
  });

  async function save(title: string, fields: CaptureFields, hide: () => void): Promise<void> {
    const text = title.trim();
    if (!text) return;
    const task = await capture(text, fields);
    void aiEnrich(task.id);
    state.saved = true;
    setTimeout(() => {
      state.saved = false;
      hide();
    }, 800);
  }

  return { state, save };
}
