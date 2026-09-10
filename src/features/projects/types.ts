/**
 * Domain types for the project feature, mirroring `Project`/`BoardColumn` in
 * `src-tauri/src/models.rs` field-for-field (serde camelCase). Write payloads
 * follow the plan §3 patch semantics: a missing field leaves the stored value
 * unchanged, an explicit `null` clears it.
 */

/** Project lifecycle state (`projects.status`); archived projects are restorable. */
export type ProjectStatus = "active" | "archived";

export interface Project {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  dueAt: string | null;
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
  dueAt?: string | null;
}

export interface UpdateProject {
  name?: string;
  description?: string | null;
  color?: string | null;
  icon?: string | null;
  dueAt?: string | null;
}

/** A kanban column (`board_columns`); ordering uses the lexicographic `position`. */
export interface BoardColumn {
  id: string;
  projectId: string;
  name: string;
  position: string;
  isDone: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface NewBoardColumn {
  projectId: string;
  name: string;
}

export interface UpdateBoardColumn {
  name?: string;
  isDone?: boolean;
}
