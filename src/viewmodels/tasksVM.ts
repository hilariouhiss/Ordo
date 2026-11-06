import { computed, reactive, watch } from "vue";
import { askNotice } from "../lib/dialog";
import { errorText, language, t } from "../lib/i18n";
import { EMPTY_FILTER, filterTasks, isEmptyFilter, sameFilter } from "../lib/taskFilter";
import { groupTasks, type TaskGroup, type TaskGrouping } from "../lib/taskGroups";
import { listAllTasks, setSettings, updateTaskPatch } from "../model/ipc";
import type { SavedTaskView, Task, TaskFilter } from "../model/types";
import { appVM } from "./appVM";
import { undoVM } from "./undoVM";

/** Local ids for saved views; no crypto requirement in the WebView. */
function newViewId(): string {
  return `view-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createTasksVM() {
  const state = reactive({
    tasks: [] as Task[],
    loading: false,
    groupBy: "project" as TaskGrouping,
    collapsed: {} as Record<string, boolean>,
    filter: { ...EMPTY_FILTER } as TaskFilter,
  });

  watch(
    () => appVM.state.settings?.tasksGroupBy,
    (saved) => {
      if (saved) state.groupBy = saved;
    },
    { immediate: true },
  );

  const filteredTasks = computed(() => filterTasks(state.tasks, state.filter));
  const isEmpty = computed(() => isEmptyFilter(state.filter));
  const savedViews = computed(() => appVM.state.settings?.savedTaskViews ?? []);
  /** The chip that matches the current filter and grouping exactly. */
  const activeViewId = computed(
    () =>
      savedViews.value.find(
        (view) => view.groupBy === state.groupBy && sameFilter(view.filter, state.filter),
      )?.id ?? null,
  );

  const sections = computed<TaskGroup[]>(() => {
    const visible = filteredTasks.value;
    if (!visible.length) return [];
    const by = state.groupBy;
    if (by === "none") return [{ key: "all", name: "", tasks: visible }];
    const groups = groupTasks(visible, {
      by,
      categories: appVM.state.categories,
      people: appVM.state.people,
      projects: appVM.state.projects,
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
    // Empty project buckets stay while unfiltered so a task can be dropped into them.
    return isEmpty.value ? groups : groups.filter((group) => group.tasks.length > 0);
  });

  async function load(): Promise<void> {
    state.loading = true;
    try {
      state.tasks = await listAllTasks();
    } finally {
      state.loading = false;
    }
  }

  function clearFilter(): void {
    Object.assign(state.filter, EMPTY_FILTER);
  }

  async function persistViews(next: SavedTaskView[]): Promise<boolean> {
    try {
      appVM.state.settings = await setSettings({ savedTaskViews: next });
      return true;
    } catch (e) {
      void askNotice(t("common.actionFailed"), errorText(e));
      return false;
    }
  }

  async function saveView(rawName: string): Promise<boolean> {
    // Code points, not UTF-16 units, so the Rust validator counts the same length.
    const name = Array.from(rawName.trim()).slice(0, 40).join("");
    if (!name || isEmpty.value) return false;
    const next = [...savedViews.value];
    const index = next.findIndex((view) => view.name === name);
    const view: SavedTaskView = {
      id: index >= 0 ? next[index].id : newViewId(),
      name,
      groupBy: state.groupBy,
      filter: { ...state.filter },
    };
    if (index >= 0) {
      next[index] = view;
    } else if (next.length >= 20) {
      void askNotice(t("filters.save"), t("filters.limit"));
      return false;
    } else {
      next.push(view);
    }
    return persistViews(next);
  }

  async function applyView(id: string): Promise<void> {
    const view = savedViews.value.find((one) => one.id === id);
    if (!view) return;
    Object.assign(state.filter, view.filter);
    if (state.groupBy !== view.groupBy) await setGroupBy(view.groupBy);
  }

  async function removeView(id: string): Promise<void> {
    const next = savedViews.value.filter((view) => view.id !== id);
    if (next.length === savedViews.value.length) return;
    await persistViews(next);
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

  async function assignProject(taskId: string, projectId: string | null): Promise<boolean> {
    const current = state.tasks.find((task) => task.id === taskId);
    if (!current || current.projectId === projectId) return false;
    const previousProjectId = current.projectId;
    try {
      const updated = await updateTaskPatch(taskId, { projectId });
      state.tasks = state.tasks.map((task) => (task.id === taskId ? updated : task));
      undoVM.pushUndo(t("undo.project", { title: updated.title }), async () => {
        await updateTaskPatch(taskId, { projectId: previousProjectId });
      });
      return true;
    } catch (e) {
      void askNotice(t("common.actionFailed"), errorText(e));
      return false;
    }
  }

  return {
    state,
    filteredTasks,
    isEmpty,
    savedViews,
    activeViewId,
    sections,
    load,
    setGroupBy,
    clearFilter,
    saveView,
    applyView,
    removeView,
    isGroupCollapsed,
    toggleGroup,
    assignProject,
  };
}

export const tasksVM = createTasksVM();
