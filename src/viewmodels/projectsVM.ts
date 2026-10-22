import { reactive } from "vue";
import { createProject, listProjects } from "../model/ipc";
import type { Project, ProjectSummary } from "../model/types";
import { appVM } from "./appVM";

export function createProjectsVM() {
  const state = reactive({
    projects: [] as ProjectSummary[],
    settingsFor: null as string | null,
    loading: false,
  });

  async function load(): Promise<void> {
    state.loading = true;
    try {
      state.projects = await listProjects();
      appVM.state.projects = state.projects;
    } finally {
      state.loading = false;
    }
  }

  let creating = false;

  async function create(name: string, dueDate: string | null): Promise<Project | null> {
    if (creating) return null;
    if (!name.trim()) return null;
    creating = true;
    try {
      const project = await createProject(name.trim(), dueDate);
      await load();
      return project;
    } finally {
      creating = false;
    }
  }

  function openSettings(id: string): void {
    state.settingsFor = id;
  }

  function closeSettings(): void {
    state.settingsFor = null;
  }

  return { state, load, create, openSettings, closeSettings };
}

export const projectsVM = createProjectsVM();
