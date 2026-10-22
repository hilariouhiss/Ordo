import { reactive } from "vue";
import {
  archiveTask as archiveTaskApi,
  deleteProject as deleteProjectApi,
  deleteTask as deleteTaskApi,
  listArchive,
  restoreProject as restoreProjectApi,
  restoreTask as restoreTaskApi,
} from "../model/ipc";
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

  async function restore(id: string): Promise<void> {
    await restoreTaskApi(id);
    await load();
  }

  async function archive(id: string): Promise<void> {
    await archiveTaskApi(id);
    await load();
  }

  async function remove(id: string): Promise<void> {
    await deleteTaskApi(id);
    await load();
  }

  async function restoreProject(id: string): Promise<void> {
    await restoreProjectApi(id);
    await projectsVM.load();
    await load();
  }

  async function removeProject(id: string): Promise<void> {
    await deleteProjectApi(id);
    await load();
  }

  return { state, load, restore, archive, remove, restoreProject, removeProject };
}

export const archiveVM = createArchiveVM();
