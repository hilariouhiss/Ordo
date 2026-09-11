/**
 * Task-domain types mirroring the Rust models (`src-tauri/src/models.rs`).
 *
 * The wire format is serde camelCase; timestamps are ISO-8601 UTC strings.
 * Update payloads follow the backend `Patch` semantics: a missing field
 * leaves the stored value unchanged, an explicit `null` clears a nullable
 * column.
 */

export type Priority = "high" | "medium" | "low" | "none";

export type RepeatFreq = "daily" | "weekly" | "monthly";

export interface RepeatRule {
  freq: RepeatFreq;
  /** Recur every `interval` periods; always >= 1. */
  interval: number;
  /** Paused rules stay attached but completing spawns no next instance. */
  paused: boolean;
}

export interface Tag {
  id: string;
  name: string;
  color: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/**
 * A task as returned by `task:list` — the row fields plus `tagIds`, the
 * task's associations to live tags (there is no separate link-read command).
 */
export interface Task {
  id: string;
  projectId: string | null;
  title: string;
  note: string | null;
  priority: Priority;
  columnId: string | null;
  dueAt: string | null;
  completedAt: string | null;
  repeatRule: RepeatRule | null;
  tagIds: string[];
  sortOrder: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Subtask {
  id: string;
  taskId: string;
  title: string;
  done: boolean;
  sortOrder: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Comment {
  id: string;
  taskId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/**
 * A time-tracking row (`time_entries`). `duration` is in seconds; a row with
 * `endedAt` unset is the task's running timer. Entries link to projects and
 * tags through their task.
 */
export interface TimeEntry {
  id: string;
  taskId: string;
  startedAt: string | null;
  endedAt: string | null;
  duration: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

// --- Write payloads ----------------------------------------------------------

export interface NewTask {
  title: string;
  note?: string | null;
  priority?: Priority;
  projectId?: string | null;
  columnId?: string | null;
  dueAt?: string | null;
  tagIds?: string[];
  subtaskTitles?: string[];
  repeatRule?: RepeatRule | null;
}

export interface UpdateTask {
  title?: string;
  note?: string | null;
  priority?: Priority;
  projectId?: string | null;
  columnId?: string | null;
  dueAt?: string | null;
  /** `null` un-completes the task; missing leaves `completedAt` unchanged. */
  completedAt?: string | null;
  tagIds?: string[];
  /** `null` cancels the rule; missing leaves `repeatRule` unchanged. */
  repeatRule?: RepeatRule | null;
}

export interface NewTag {
  name: string;
  color?: string | null;
}

export interface UpdateTag {
  name?: string;
  color?: string | null;
}

export interface NewSubtask {
  title: string;
}

export interface UpdateSubtask {
  title?: string;
  done?: boolean;
}

export interface NewComment {
  body: string;
}

/** Comments only have a body; edits replace it wholesale. */
export interface UpdateComment {
  body: string;
}

/** A manual time entry; the backend derives `endedAt` from start + duration. */
export interface NewTimeEntry {
  startedAt: string;
  /** Tracked seconds; must be >= 1. */
  duration: number;
}

/** Missing fields keep their stored value; `endedAt` is always re-derived. */
export interface UpdateTimeEntry {
  startedAt?: string;
  duration?: number;
}
