import { reactive } from "vue";
import { capture as captureApi, listWeek } from "../model/ipc";
import type { Task } from "../model/types";

export function createWeekVM() {
  const state = reactive({
    tasks: [] as Task[],
    draft: "",
    loading: false,
  });

  async function load(): Promise<void> {
    state.loading = true;
    try {
      state.tasks = await listWeek();
    } finally {
      state.loading = false;
    }
  }

  async function capture(raw: string): Promise<void> {
    const text = raw.trim();
    if (!text) return;
    const task = await captureApi(text);
    state.tasks = [task, ...state.tasks];
    if (state.draft.trim() === text) state.draft = "";
  }

  return { state, load, capture };
}

export const weekVM = createWeekVM();
