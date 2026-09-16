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
  complexity: number | null;
  /** Parent task; `null` for a top-level task. The hierarchy is one level. */
  parentTaskId: string | null;
  tagIds: string[];
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
  complexity?: number | null;
  /** `parentTaskId` files the task under a parent; missing = top-level. */
  parentTaskId?: string | null;
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
  complexity?: number | null;
  /** `null` moves the task out of its parent; missing leaves it filed. */
  parentTaskId?: string | null;
}

export interface NewTag {
  name: string;
  color?: string | null;
}

export interface UpdateTag {
  name?: string;
  color?: string | null;
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

// --- dependency edges --------------------------------------------------------

/**
 * One dependency edge: `prerequisiteId` must be finished before
 * `dependentId` can be completed. Both endpoints are tasks — a child task is
 * a task, so one edge set covers the whole tree.
 */
export interface Dependency {
  dependentId: string;
  prerequisiteId: string;
}

// --- scope pages (lazy loading) ----------------------------------------------

/** A row reference: supplies the title for a standalone child's 父任务 prefix. */
export interface TaskRef {
  id: string;
  title: string;
}

/** How many of a row's prerequisites are still unfinished (server-computed). */
export interface TaskBlocked {
  taskId: string;
  count: number;
}

/** One rewritten sort key — a key-exhaustion rebalance rewrites the scope. */
export interface TaskKey {
  id: string;
  sortOrder: string;
}

/** What `task:reorder` / `board:moveTask` answer with. */
export interface Reorder {
  moved: Task;
  rebalanced: TaskKey[];
}

/**
 * One scope query's payload. `children` carries **every** child of the
 * top-level rows in `rows` (children ignore the view predicate and the toolbar
 * filters), `related` fills in parent titles for children whose parent is not
 * in the page, and `blocked` answers the soft-blocking badge without shipping
 * the dependency graph.
 */
export interface TaskPage {
  rows: Task[];
  children: Task[];
  related: TaskRef[];
  blocked: TaskBlocked[];
  hasMore: boolean;
  cursor: string | null;
}
