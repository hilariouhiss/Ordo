import { computed, reactive } from "vue";
import { language, t } from "../lib/i18n";
import { groupTasks, type TaskGroup, type TaskGroupBy } from "../lib/taskGroups";
import { listAllTasks } from "../model/ipc";
import type { Task } from "../model/types";
import { appVM } from "./appVM";

type TaskGrouping = TaskGroupBy | "none";

export function createTasksVM() {
  const state = reactive({
    tasks: [] as Task[],
    loading: false,
    groupBy: "none" as TaskGrouping,
  });

  const sections = computed<TaskGroup[]>(() => {
    if (!state.tasks.length) return [];
    const by = state.groupBy;
    if (by === "none") return [{ key: "all", name: "", tasks: state.tasks }];
    return groupTasks(state.tasks, {
      by,
      categories: appVM.state.categories,
      collator: new Intl.Collator(language.value, { sensitivity: "base", numeric: true }),
      noneName:
        by === "project"
          ? t("task.noProject")
          : by === "category"
            ? t("common.uncategorized")
            : t("tasks.noTag"),
    });
  });

  async function load(): Promise<void> {
    state.loading = true;
    try {
      state.tasks = await listAllTasks();
    } finally {
      state.loading = false;
    }
  }

  function setGroupBy(next: TaskGrouping): void {
    state.groupBy = next;
  }

  return { state, sections, load, setGroupBy };
}

export const tasksVM = createTasksVM();
