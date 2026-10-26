import { reactive } from "vue";
import {
  createProject,
  createProjectGroup,
  deleteProjectGroup,
  listProjectGroups,
  listProjects,
  renameProjectGroup,
} from "../model/ipc";
import type { Project, ProjectGroup, ProjectSummary } from "../model/types";
import { appVM } from "./appVM";

export function createProjectsVM() {
  const state = reactive({
    projects: [] as ProjectSummary[],
    groups: [] as ProjectGroup[],
    settingsFor: null as string | null,
    loading: false,
  });

  async function load(): Promise<void> {
    state.loading = true;
    try {
      const [projects, groups] = await Promise.all([listProjects(), listProjectGroups()]);
      state.projects = projects;
      state.groups = groups;
      appVM.state.projects = projects;
    } finally {
      state.loading = false;
    }
  }

  let creating = false;

  async function create(name: string): Promise<Project | null> {
    if (creating) return null;
    if (!name.trim()) return null;
    creating = true;
    try {
      const project = await createProject(name.trim());
      await load();
      return project;
    } finally {
      creating = false;
    }
  }

  async function createGroup(name: string): Promise<ProjectGroup | null> {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const group = await createProjectGroup(trimmed);
    await load();
    return group;
  }

  async function renameGroup(id: string, name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) return;
    await renameProjectGroup(id, trimmed);
    await load();
  }

  async function removeGroup(id: string): Promise<void> {
    await deleteProjectGroup(id);
    await load();
  }

  function openSettings(id: string): void {
    state.settingsFor = id;
  }

  function closeSettings(): void {
    state.settingsFor = null;
  }

  return {
    state,
    load,
    create,
    createGroup,
    renameGroup,
    removeGroup,
    openSettings,
    closeSettings,
  };
}

export const projectsVM = createProjectsVM();
