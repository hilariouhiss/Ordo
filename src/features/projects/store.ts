/**
 * Full-data project store (module-level `createStore`, mirroring the task
 * domain conventions). Holds every live project — archived ones included, so
 * the sidebar can offer restore — and exposes the derived nav lists.
 *
 * Mutators below are the data layer's plumbing — components change state
 * through `hooks.ts`, never directly.
 */

import { createStore, produce } from "solid-js/store";
import type { Project } from "./types";

export interface ProjectsState {
  /** All live projects (active + archived), ordered by `sortOrder`. */
  projects: Project[];
  /** Whether the initial `loadAll` completed successfully. */
  loaded: boolean;
}

const [state, setState] = createStore<ProjectsState>({
  projects: [],
  loaded: false,
});

/** Reactive store state; read from components, mutate through hooks. */
export const projectsState = state;

export function getProject(id: string): Project | undefined {
  return state.projects.find((project) => project.id === id);
}

/** Projects shown in the navigation: live and not archived. */
export function activeProjects(): Project[] {
  return state.projects.filter((project) => project.status === "active");
}

/** Archived projects, for the sidebar's restore section. */
export function archivedProjects(): Project[] {
  return state.projects.filter((project) => project.status === "archived");
}

// --- mutators (data-layer plumbing; see module docs) -------------------------

export function setAll(projects: Project[]): void {
  setState({ projects, loaded: true });
}

export function upsertProject(project: Project): void {
  setState(
    "projects",
    produce((list: Project[]) => {
      const index = list.findIndex((item) => item.id === project.id);
      if (index === -1) {
        list.push(project);
      } else {
        list[index] = project;
      }
    }),
  );
}

export function patchProject(id: string, patch: Partial<Project>): void {
  setState(
    "projects",
    produce((list: Project[]) => {
      const project = list.find((item) => item.id === id);
      if (project) Object.assign(project, patch);
    }),
  );
}

export function removeProject(id: string): void {
  setState("projects", (list) => list.filter((project) => project.id !== id));
}

export function insertProjectAt(index: number, project: Project): void {
  setState(
    "projects",
    produce((list: Project[]) => {
      list.splice(Math.min(Math.max(index, 0), list.length), 0, project);
    }),
  );
}

/** Resets the store to its pristine state (test seam). */
export function resetProjectsStore(): void {
  setState({ projects: [], loaded: false });
}
