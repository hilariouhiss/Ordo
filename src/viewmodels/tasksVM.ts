import { reactive } from "vue";
import { listAllTasks } from "../model/ipc";
import type { Task } from "../model/types";

export function createTasksVM() {
  const state = reactive({
    tasks: [] as Task[],
    loading: false,
  });

  async function load(): Promise<void> {
    state.loading = true;
    try {
      state.tasks = await listAllTasks();
    } finally {
      state.loading = false;
    }
  }

  return { state, load };
}

export const tasksVM = createTasksVM();
