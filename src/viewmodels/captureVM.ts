import { reactive } from "vue";
import { aiEnrich, capture } from "../model/ipc";

export function createCaptureVM() {
  const state = reactive({
    draft: "",
    saved: false,
  });

  async function save(raw: string, hide: () => void): Promise<void> {
    const text = raw.trim();
    if (!text) return;
    const task = await capture(text);
    void aiEnrich(task.id);
    state.saved = true;
    setTimeout(() => {
      state.saved = false;
      hide();
    }, 800);
  }

  return { state, save };
}
