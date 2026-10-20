import { reactive } from "vue";
import { todayIso } from "../lib/dates";
import {
  aiEnrich,
  capture as captureApi,
  listSuspended,
  listWeek,
  markNotificationsSeen,
  resumeTask,
  weekStats,
} from "../model/ipc";
import type { Task, WeekStats } from "../model/types";

export function createWeekVM() {
  const state = reactive({
    tasks: [] as Task[],
    draft: "",
    loading: false,
    suspended: [] as Task[],
    stats: { added: 0, done: 0, delayed: 0 } as WeekStats,
  });

  async function load(): Promise<void> {
    state.loading = true;
    try {
      const today = todayIso();
      const [tasks, suspended, stats] = await Promise.all([
        listWeek(),
        listSuspended(),
        weekStats(today),
      ]);
      state.tasks = tasks;
      state.suspended = suspended;
      state.stats = stats;
      void markNotificationsSeen();
    } finally {
      state.loading = false;
    }
  }

  async function capture(raw: string): Promise<void> {
    const text = raw.trim();
    if (!text) return;
    const task = await captureApi(text);
    state.tasks = [task, ...state.tasks];
    void aiEnrich(task.id);
    if (state.draft.trim() === text) state.draft = "";
  }

  async function resume(id: string): Promise<void> {
    await resumeTask(id);
    await load();
  }

  return { state, load, capture, resume };
}

export const weekVM = createWeekVM();
