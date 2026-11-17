import { reactive } from "vue";
import * as ipc from "../model/ipc";
import type { Issue, IssuePatch } from "../model/types";

export function createIssuesVM() {
  const state = reactive({
    projectId: null as string | null,
    issues: [] as Issue[],
    error: null as string | null,
    loading: false,
    focusIssueId: null as string | null,
  });

  let run = 0;

  async function load(projectId: string): Promise<void> {
    const current = ++run;
    state.loading = true;
    try {
      const issues = await ipc.listIssues(projectId);
      if (current !== run) return;
      if (state.projectId !== projectId) state.focusIssueId = null;
      state.projectId = projectId;
      state.issues = issues;
    } finally {
      if (current === run) state.loading = false;
    }
  }

  async function reload(): Promise<void> {
    if (state.projectId) await load(state.projectId);
  }

  async function write(action: () => Promise<unknown>): Promise<boolean> {
    state.error = null;
    try {
      await action();
    } catch (e) {
      state.error = String(e);
      return false;
    }
    try {
      await reload();
    } catch (e) {
      state.error = String(e);
    }
    return true;
  }

  async function add(projectId: string, title: string): Promise<boolean> {
    const name = title.trim();
    if (!name) return false;
    return write(() => ipc.createIssue(projectId, name));
  }

  async function update(id: string, patch: IssuePatch): Promise<boolean> {
    return write(() => ipc.updateIssue(id, patch));
  }

  async function remove(id: string): Promise<boolean> {
    return write(() => ipc.deleteIssue(id));
  }

  async function createTask(issueId: string, title: string): Promise<boolean> {
    const name = title.trim();
    if (!name) return false;
    return write(() => ipc.createIssueTask(issueId, name));
  }

  async function linkTask(taskId: string, issueId: string): Promise<boolean> {
    return write(() => ipc.updateTaskPatch(taskId, { issueId }));
  }

  async function unlinkTask(taskId: string): Promise<boolean> {
    return write(() => ipc.updateTaskPatch(taskId, { issueId: null }));
  }

  function focus(id: string): void {
    state.focusIssueId = id;
  }

  return {
    state,
    load,
    reload,
    add,
    update,
    remove,
    createTask,
    linkTask,
    unlinkTask,
    focus,
  };
}

export const issuesVM = createIssuesVM();
