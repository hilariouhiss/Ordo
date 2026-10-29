import { computed, reactive, watch } from "vue";
import { language, t } from "../lib/i18n";
import { groupTasks, type TaskGroup, type TaskGrouping } from "../lib/taskGroups";
import { listAllTasks, setSettings } from "../model/ipc";
import type { Task } from "../model/types";
import { appVM } from "./appVM";

export function createTasksVM() {
  const state = reactive({
    tasks: [] as Task[],
    loading: false,
    groupBy: "none" as TaskGrouping,
    collapsed: {} as Record<string, boolean>,
  });

  watch(
    () => appVM.state.settings?.tasksGroupBy,
    (saved) => {
      if (saved) state.groupBy = saved;
    },
    { immediate: true },
  );

  const sections = computed<TaskGroup[]>(() => {
    if (!state.tasks.length) return [];
    const by = state.groupBy;
    if (by === "none") return [{ key: "all", name: "", tasks: state.tasks }];
    return groupTasks(state.tasks, {
      by,
      categories: appVM.state.categories,
      people: appVM.state.people,
      priorityLabels: {
        high: t("task.priorityHigh"),
        normal: t("task.priorityNormal"),
        low: t("task.priorityLow"),
      },
      collator: new Intl.Collator(language.value, { sensitivity: "base", numeric: true }),
      noneName:
        by === "project"
          ? t("task.noProject")
          : by === "category"
            ? t("common.uncategorized")
            : by === "tag"
              ? t("tasks.noTag")
              : t("task.unassigned"),
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

  async function setGroupBy(next: TaskGrouping): Promise<void> {
    if (state.groupBy === next) return;
    state.groupBy = next;
    try {
      await setSettings({ tasksGroupBy: next });
      // A slower reply must not pull the tab back after another click.
      if (state.groupBy === next && appVM.state.settings) {
        appVM.state.settings.tasksGroupBy = next;
      }
    } catch {
      // Best effort: the list still works if the preference cannot be saved.
    }
  }

  function isGroupCollapsed(key: string): boolean {
    return !!state.collapsed[`${state.groupBy}:${key}`];
  }

  function toggleGroup(key: string): void {
    const id = `${state.groupBy}:${key}`;
    state.collapsed[id] = !state.collapsed[id];
  }

  return { state, sections, load, setGroupBy, isGroupCollapsed, toggleGroup };
}

export const tasksVM = createTasksVM();
