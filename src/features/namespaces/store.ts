/**
 * Full-data namespace store (module-level `createStore`, mirroring the project
 * domain conventions). Holds every live namespace — archived ones included, so
 * the sidebar can offer restore — and owns the grouping derivations, because
 * "which projects belong to which namespace" is the cross-domain quantity this
 * feature exists for.
 *
 * Mutators below are the data-layer's plumbing — components change state
 * through `hooks.ts`, never directly.
 */

import { createStore, produce } from "solid-js/store";
import { projectsState } from "../projects/store";
import type { Project } from "../projects/types";
import type { Namespace } from "./types";

export interface NamespacesState {
  /** All live namespaces (active + archived), ordered by `sortOrder`. */
  namespaces: Namespace[];
  /** Whether the initial `loadAll` completed successfully. */
  loaded: boolean;
}

const [state, setState] = createStore<NamespacesState>({
  namespaces: [],
  loaded: false,
});

/** Reactive store state; read from components, mutate through hooks. */
export const namespacesState = state;

export function getNamespace(id: string): Namespace | undefined {
  return state.namespaces.find((namespace) => namespace.id === id);
}

/** Namespaces shown in the navigation: live and not archived. */
export function activeNamespaces(): Namespace[] {
  return state.namespaces.filter((namespace) => namespace.status === "active");
}

/** Archived namespaces, for the sidebar's restore section. */
export function archivedNamespaces(): Namespace[] {
  return state.namespaces.filter((namespace) => namespace.status === "archived");
}

/**
 * Whether a `namespaceId` resolves to a namespace we know about.
 *
 * "Live" means *not soft-deleted* — `namespace:list` already filters those out.
 * An **archived** namespace still counts: its projects stay nested under it in
 * the archived section rather than falling back to the root list. A project
 * whose id resolves to nothing is an orphan and is shown as ungrouped, which is
 * what keeps a deleted namespace from making its projects vanish.
 */
export function isNamespaceLive(id: string): boolean {
  return getNamespace(id) !== undefined;
}

/** Whether a namespace is archived. Unknown ids are *not* archived — they are
 * orphans, and §5.3 shows those as ungrouped instead of as an archived group. */
export function isNamespaceArchived(id: string): boolean {
  return getNamespace(id)?.status === "archived";
}

/** Active projects filed under a live namespace, by `sortOrder`. */
export function projectsInNamespace(namespaceId: string): Project[] {
  return projectsState.projects.filter(
    (project) => project.namespaceId === namespaceId && project.status === "active",
  );
}

/** Active projects on the root list: unfiled, or filed under a namespace we
 * cannot resolve any more. */
export function ungroupedProjects(): Project[] {
  return projectsState.projects.filter(
    (project) =>
      project.status === "active" &&
      (project.namespaceId === null || !isNamespaceLive(project.namespaceId)),
  );
}

/** Archived projects that stay in the flat archived list: unfiled ones, orphans,
 * and those whose namespace is still in the navigation. Archived projects of an
 * *archived* namespace are nested under that group instead. */
export function archivedLooseProjects(): Project[] {
  return projectsState.projects.filter((project) => {
    if (project.status !== "archived") return false;
    if (project.namespaceId === null) return true;
    return !isNamespaceArchived(project.namespaceId);
  });
}

/** Every live project filed under a namespace, whatever its own status — what
 * an archived namespace lists when the group is expanded.
 *
 * The sidebar's archived group is the intended caller: `projectsInNamespace`
 * also matches an archived namespace's active projects, so rendering both for
 * one group would list them twice. */
export function archivedProjectsOf(namespaceId: string): Project[] {
  return projectsState.projects.filter(
    (project) => project.namespaceId === namespaceId,
  );
}

// --- mutators (data-layer plumbing; see module docs) -------------------------

export function setAll(namespaces: Namespace[]): void {
  setState({ namespaces, loaded: true });
}

export function upsertNamespace(namespace: Namespace): void {
  setState(
    "namespaces",
    produce((list: Namespace[]) => {
      const index = list.findIndex((item) => item.id === namespace.id);
      if (index === -1) {
        list.push(namespace);
      } else {
        list[index] = namespace;
      }
    }),
  );
}

export function patchNamespace(id: string, patch: Partial<Namespace>): void {
  setState(
    "namespaces",
    produce((list: Namespace[]) => {
      const namespace = list.find((item) => item.id === id);
      if (namespace) Object.assign(namespace, patch);
    }),
  );
}

export function removeNamespace(id: string): void {
  setState("namespaces", (list) => list.filter((namespace) => namespace.id !== id));
}

/** Resets the store to its pristine state (test seam). */
export function resetNamespacesStore(): void {
  setState({ namespaces: [], loaded: false });
}
