import { reactive } from "vue";
import {
  aiEnrich,
  capture,
  getProjectSummary,
  listProjectTasks,
  updateTaskPatch,
} from "../model/ipc";
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
    await updateTaskPatch(task.id, { projectId });
    state.draft = "";
    void aiEnrich(task.id);
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
