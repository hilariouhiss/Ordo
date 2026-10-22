import { computed, reactive } from "vue";
import type { CaptureSubmission } from "../lib/capture";
import { projectSummaryLine } from "../lib/summary";
import { aiEnrich, capture, getProjectSummary, listProjectTasks, listWeek } from "../model/ipc";
import type { ProjectSummary, Task } from "../model/types";
import { warnExclusiveConflict } from "./planning";

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

  const summaryLine = computed(() => (state.summary ? projectSummaryLine(state.summary) : ""));

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

  let capturing = false;

  async function captureInto(projectId: string, submission: CaptureSubmission): Promise<void> {
    if (capturing) return;
    const title = submission.title.trim();
    if (!title) return;
    capturing = true;
    try {
      const task = await capture(title, submission.fields);
      void aiEnrich(task.id);
      state.draft = "";
      await load(projectId);
      const week = await listWeek().catch(() => null);
      if (week) warnExclusiveConflict(task, week);
    } finally {
      capturing = false;
    }
  }

  async function copySummary(): Promise<void> {
    if (!state.summary) return;
    await navigator.clipboard.writeText(summaryLine.value);
    state.copied = true;
    setTimeout(() => {
      state.copied = false;
    }, 1500);
  }

  return { state, summaryLine, load, toggle, captureInto, copySummary };
}
