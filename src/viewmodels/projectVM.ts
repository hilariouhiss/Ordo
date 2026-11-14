import { computed, reactive } from "vue";
import type { CaptureSubmission } from "../lib/capture";
import { askNotice } from "../lib/dialog";
import { errorText, t } from "../lib/i18n";
import { projectSummaryLine } from "../lib/summary";
import {
  createMilestone,
  deleteMilestone,
  getProjectSummary,
  listProjectTasks,
  renameMilestone as renameMilestoneIpc,
  setMilestoneDate as setMilestoneDateIpc,
  setMilestoneDone,
} from "../model/ipc";
import type { Milestone, ProjectSummary, Task } from "../model/types";
import { saveCapture } from "./captureSave";

export function createProjectVM() {
  const state = reactive({
    summary: null as ProjectSummary | null,
    milestones: [] as Milestone[],
    milestoneError: null as string | null,
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
      state.milestones = summary.milestones;
      state.tasks = tasks;
      // Open every category the first time: the page's work should be visible, not hidden.
      if (Object.keys(state.expanded).length === 0) {
        for (const category of summary.byCategory) state.expanded[category.categoryId] = true;
      }
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
      try {
        await saveCapture(title, submission.fields, submission.newProjectName, submission.done);
      } catch (e) {
        void askNotice(t("common.actionFailed"), errorText(e));
        return;
      }
      await load(projectId);
      if (state.draft.trim() === submission.raw.trim()) state.draft = "";
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

  /**
   * One failed milestone write is shown inline and must not abort the page. The
   * write and the refresh are separate failures: a landed write whose refresh
   * failed is still a success, or a retry would create the milestone twice.
   */
  async function writeMilestone(
    projectId: string,
    write: () => Promise<unknown>,
  ): Promise<boolean> {
    state.milestoneError = null;
    try {
      await write();
    } catch (e) {
      state.milestoneError = String(e);
      return false;
    }
    try {
      await load(projectId);
    } catch {
      state.milestoneError = t("common.refreshFailed");
    }
    return true;
  }

  let adding = false;

  async function addMilestone(projectId: string, title: string, dueDate: string): Promise<boolean> {
    const name = title.trim();
    if (!name || adding) return false;
    adding = true;
    try {
      return await writeMilestone(projectId, () =>
        createMilestone(projectId, name, dueDate || null),
      );
    } finally {
      adding = false;
    }
  }

  async function renameMilestone(
    projectId: string,
    milestone: Milestone,
    title: string,
  ): Promise<boolean> {
    const name = title.trim();
    if (!name) return false;
    return writeMilestone(projectId, () => renameMilestoneIpc(milestone.id, name));
  }

  async function setMilestoneDate(
    projectId: string,
    milestone: Milestone,
    dueDate: string,
  ): Promise<void> {
    await writeMilestone(projectId, () => setMilestoneDateIpc(milestone.id, dueDate || null));
  }

  async function toggleMilestone(projectId: string, milestone: Milestone): Promise<void> {
    await writeMilestone(projectId, () => setMilestoneDone(milestone.id, !milestone.doneAt));
  }

  async function removeMilestone(projectId: string, id: string): Promise<void> {
    await writeMilestone(projectId, () => deleteMilestone(id));
  }

  return {
    state,
    summaryLine,
    load,
    toggle,
    captureInto,
    copySummary,
    addMilestone,
    renameMilestone,
    setMilestoneDate,
    toggleMilestone,
    removeMilestone,
  };
}
