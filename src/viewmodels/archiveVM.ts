import { reactive } from "vue";
import {
  archiveTask as archiveTaskApi,
  deleteProject as deleteProjectApi,
  deleteTask as deleteTaskApi,
  listArchive,
  restoreProject as restoreProjectApi,
  restoreTask as restoreTaskApi,
} from "../model/ipc";
import { askNotice, runWithNotice } from "../lib/dialog";
import { errorText, t } from "../lib/i18n";
import type { ArchiveData } from "../model/types";
import { projectsVM } from "./projectsVM";

export type ArchiveTab = "projects" | "tasks" | "canceled" | "done";

export function createArchiveVM() {
  const state = reactive({
    query: "",
    tab: "projects" as ArchiveTab,
    data: { projects: [], tasks: [], canceled: [], done: [] } as ArchiveData,
    loading: false,
  });

  async function load(): Promise<void> {
    state.loading = true;
    try {
      state.data = await listArchive(state.query.trim() || null);
    } finally {
      state.loading = false;
    }
  }

  /** A successful action must not be reported as failed just because the list is stale. */
  async function refresh(): Promise<void> {
    try {
      await load();
    } catch (e) {
      void askNotice(t("common.refreshFailed"), errorText(e));
    }
  }

  async function restore(id: string): Promise<void> {
    if (!(await runWithNotice(() => restoreTaskApi(id)))) return;
    await refresh();
  }

  async function archive(id: string): Promise<void> {
    if (!(await runWithNotice(() => archiveTaskApi(id)))) return;
    await refresh();
  }

  async function remove(id: string): Promise<void> {
    if (!(await runWithNotice(() => deleteTaskApi(id)))) return;
    await refresh();
  }

  async function restoreProject(id: string): Promise<void> {
    if (!(await runWithNotice(() => restoreProjectApi(id)))) return;
    try {
      await projectsVM.load();
    } catch (e) {
      void askNotice(t("common.refreshFailed"), errorText(e));
    }
    await refresh();
  }

  async function removeProject(id: string): Promise<void> {
    if (!(await runWithNotice(() => deleteProjectApi(id)))) return;
    await refresh();
  }

  return { state, load, restore, archive, remove, restoreProject, removeProject };
}

export const archiveVM = createArchiveVM();
