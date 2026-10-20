import { reactive } from "vue";
import { capture, getProjectSummary, listProjectTasks, updateTask } from "../model/ipc";
import type { ProjectSummary, Task } from "../model/types";

export function createProjectVM() {
  const state = reactive({
    summary: null as ProjectSummary | null,
    tasks: [] as Task[],
    expanded: {} as Record<string, boolean>,
    view: "group" as "group" | "timeline",
    draft: "",
    loading: false,
    copied: false,
  });

  async function load(id: string): Promise<void> {
    state.loading = true;
    try {
      const [summary, tasks] = await Promise.all([getProjectSummary(id), listProjectTasks(id)]);
      state.summary = summary;
      state.tasks = tasks;
    } finally {
      state.loading = false;
    }
  }

  function toggle(categoryId: string): void {
    state.expanded[categoryId] = !state.expanded[categoryId];
  }

  async function captureInto(projectId: string): Promise<void> {
    const raw = state.draft.trim();
    if (!raw) return;
    const task = await capture(raw);
    await updateTask(task.id, {
      title: task.title,
      projectId,
      categoryId: task.categoryId,
      ownerId: task.ownerId,
      startDate: task.startDate,
      dueDate: task.dueDate,
      note: task.note,
    });
    state.draft = "";
    await load(projectId);
  }

  async function copySummary(): Promise<void> {
    if (!state.summary) return;
    await navigator.clipboard.writeText(state.summary.summaryLine);
    state.copied = true;
    setTimeout(() => {
      state.copied = false;
    }, 1500);
  }

  return { state, load, toggle, captureInto, copySummary };
}
