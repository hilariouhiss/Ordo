import { reactive } from "vue";
import { capture } from "../model/ipc";

export function createCaptureVM() {
  const state = reactive({
    draft: "",
    saved: false,
  });

  async function save(raw: string, hide: () => void): Promise<void> {
    const text = raw.trim();
    if (!text) return;
    await capture(text);
    state.saved = true;
    setTimeout(() => {
      state.saved = false;
      hide();
    }, 800);
  }

  return { state, save };
}
