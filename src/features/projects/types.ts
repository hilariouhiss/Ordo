/**
 * Domain types for the project feature, mirroring `Project` in
 * `src-tauri/src/models.rs` field-for-field (serde camelCase). Write payloads
 * follow the plan §3 patch semantics: a missing field leaves the stored value
 * unchanged, an explicit `null` clears it.
 *
 * There is no `dueAt`: a deadline belongs to a task, not to a project (R2).
 */

/** Project lifecycle state (`projects.status`); archived projects are restorable. */
export type ProjectStatus = "active" | "archived";

export interface Project {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  namespaceId: string | null;
  status: ProjectStatus;
  sortOrder: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface NewProject {
  name: string;
  description?: string | null;
  color?: string | null;
  icon?: string | null;
  namespaceId?: string | null;
}

export interface UpdateProject {
  name?: string;
  description?: string | null;
  color?: string | null;
  icon?: string | null;
  namespaceId?: string | null;
}

