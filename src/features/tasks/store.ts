/**
 * Task store: a **by-id table over named scopes**.
 *
 * One row per task (`byId`), scopes hold ids only — a task that is in 今天 and
 * in a project is a single row both scopes point at, so an edit cannot leave
 * two copies to disagree.
 *
 * For now `task:list` is still the only source of data and it fills a scope
 * called `all`; the read sites go through `tasks()`, which is the old
 * `tasksState.tasks` array re-derived. As `task:listByProject` /
 * `task:listView` land, the surfaces move to their own scopes one at a time,
 * and `all` + `tasks()` go away with the last one.
 *
 * Mutators are the data layer's plumbing — components change state through
 * `hooks.ts`, never directly.
 */

import { createStore, produce } from "solid-js/store";
import { edgeEquals } from "./dependencies";
import type {
  Comment,
  Dependency,
  ProjectUnfinished,
  Tag,
  Task,
  TaskKey,
  TaskPage,
  TaskRef,
  TimeEntry,
} from "./types";

/** A scope's loading state. `cursor` is the keyset cursor for its next page. */
export interface ScopeMeta {
  loaded: boolean;
  loading: boolean;
  hasMore: boolean;
  cursor: string | null;
  error: string | null;
}

export interface TasksState {
  /** The canonical table: exactly one row per task. */
  byId: Record<string, Task>;
  /** Named scopes → ordered ids (`all` / `project:<id>` / `view:<view>`). */
  scopes: Record<string, string[]>;
  /** Per-scope loading state. */
  scopeMeta: Record<string, ScopeMeta>;
  /** parentId → child ids (a scope page's `children` plus any matched child). */
  childrenByParent: Record<string, string[]>;
  /** id → `{ id, title }`: parent titles for rows whose parent is off-scope. */
  related: Record<string, TaskRef>;
  /** taskId → unfinished prerequisite count (the server's number). */
  blocked: Record<string, number>;
  /** projectId → 顶层未完成行数（服务端口径，`project:unfinishedCounts`）。 */
  unfinishedByProject: Record<string, number>;
  /** All live tags, ordered by name (case-insensitive). */
  tags: Tag[];
  /** Every live dependency edge, loaded with the task snapshot (until the
   * dependency read is scoped too). */
  dependencies: Dependency[];
  /** Comment cache per task, filled on demand by `loadComments`. */
  commentsByTask: Record<string, Comment[]>;
  /** Time-entry cache per task, filled on demand by `loadTimeEntries`;
   * most recent first, as `time:list` returns them. */
  timeEntriesByTask: Record<string, TimeEntry[]>;
  /** Whether the transitional `all` scope has loaded. */
  loaded: boolean;
}

function emptyState(): TasksState {
  return {
    byId: {},
    scopes: {},
    scopeMeta: {},
    childrenByParent: {},
    related: {},
    blocked: {},
    unfinishedByProject: {},
    tags: [],
    dependencies: [],
    commentsByTask: {},
    timeEntriesByTask: {},
    loaded: false,
  };
}

const [state, setState] = createStore<TasksState>(emptyState());

/** Reactive store state; read from components, mutate through hooks. */
export const tasksState = state;

/** Mirrors the SQL `ORDER BY sort_order, created_at, id`. */
const bySortOrder = (a: Task, b: Task) => {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder < b.sortOrder ? -1 : 1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

/**
 * The `all` scope's rows in key order — the transitional stand-in for the old
 * `tasksState.tasks`. Every read site goes through this until its own scope
 * lands; then it is deleted along with `task:list`.
 *
 * Sorted here, not kept sorted: the sort key is the only truth about order
 * (the same `sort_order, created_at, id` that `task:list` orders by), so a
 * reorder that patches one key is reflected everywhere at once.
 */
export function tasks(): Task[] {
  const ids = state.scopes.all ?? [];
  const rows: Task[] = [];
  for (const id of ids) {
    const task = state.byId[id];
    if (task) rows.push(task);
  }
  return rows.sort(bySortOrder);
}

/**
 * A scope's rows in the scope's own order (the server's `ORDER BY`). The
 * transitional `tasks()` sorts by key because the `all` snapshot arrives in one
 * shot; a real scope arrives already ordered and is not re-sorted here.
 */
export function scopeRows(scope: string): Task[] {
  const ids = state.scopes[scope] ?? [];
  const rows: Task[] = [];
  for (const id of ids) {
    const task = state.byId[id];
    if (task) rows.push(task);
  }
  return rows;
}

export function scopeMetaOf(scope: string): ScopeMeta {
  return (
    state.scopeMeta[scope] ?? {
      loaded: false,
      loading: false,
      hasMore: false,
      cursor: null,
      error: null,
    }
  );
}

export function getTask(id: string): Task | undefined {
  return state.byId[id];
}

export function getTag(id: string): Tag | undefined {
  return state.tags.find((tag) => tag.id === id);
}

/**
 * A parent's children in `sortOrder`. The index is filled by the scope pages
 * that carried them (R7c: a child is a plain row, so this is a lookup, never a
 * second load).
 */
export function childrenOf(taskId: string): Task[] {
  return (state.childrenByParent[taskId] ?? [])
    .map((id) => state.byId[id])
    .filter((task): task is Task => task !== undefined)
    .sort(bySortOrder);
}

/** Top-level tasks across the loaded scopes, in the `all` scope's order. */
export function topLevelTasks(): Task[] {
  return tasks().filter((task) => task.parentTaskId === null);
}

/** Whether a task has children — the disclosure arrow, the drop rule, the badge. */
export function hasChildren(taskId: string): boolean {
  return (state.childrenByParent[taskId] ?? []).length > 0;
}

/** Unfinished prerequisite count as the backend counted it on the last load. */
export function blockedCountOf(taskId: string): number {
  return state.blocked[taskId] ?? 0;
}

/** 侧边栏箭头用的每项目未完成顶层行数；`setUnfinishedCounts` 是合并写而不是
 * 整表替换，所以服务端这次没提到的项目（已删的那些）留着上一次的数，从没提到
 * 过的才按 0（不画箭头）。 */
export function unfinishedCountOf(projectId: string): number {
  return state.unfinishedByProject[projectId] ?? 0;
}

/**
 * The 父任务 prefix of a standalone child row: the page's `related` ref when the
 * parent is off-scope, the loaded row when it is on-scope, and the old
 * fallback when neither knows it.
 */
export function parentTitleOf(childId: string): string {
  const parentId = state.byId[childId]?.parentTaskId;
  if (!parentId) return "（已删除）";
  return state.related[parentId]?.title ?? state.byId[parentId]?.title ?? "（已删除）";
}

export function getComments(taskId: string): Comment[] {
  return state.commentsByTask[taskId] ?? [];
}

/** Whether the task's comment list has been loaded into the cache. */
export function hasComments(taskId: string): boolean {
  return taskId in state.commentsByTask;
}

export function getTimeEntries(taskId: string): TimeEntry[] {
  return state.timeEntriesByTask[taskId] ?? [];
}

/** Whether the task's time-entry list has been loaded into the cache. */
export function hasTimeEntries(taskId: string): boolean {
  return taskId in state.timeEntriesByTask;
}

/** Index of a task in the transitional `all` scope, or -1. */
export function taskIndex(id: string): number {
  return (state.scopes.all ?? []).indexOf(id);
}

// --- scope plumbing ----------------------------------------------------------

/** The view shows its skeleton off this. */
export function markScopeLoading(scope: string, loading: boolean): void {
  setState("scopeMeta", scope, (meta: ScopeMeta | undefined) => ({
    loaded: meta?.loaded ?? false,
    loading,
    hasMore: meta?.hasMore ?? false,
    cursor: meta?.cursor ?? null,
    error: loading ? null : (meta?.error ?? null),
  }));
}

/** A failed load lands here; the view's retry button reads it. */
export function markScopeError(scope: string, message: string): void {
  setState("scopeMeta", scope, (meta: ScopeMeta | undefined) => ({
    loaded: meta?.loaded ?? false,
    loading: false,
    hasMore: meta?.hasMore ?? false,
    cursor: meta?.cursor ?? null,
    error: message,
  }));
}

/** `project:<id>` 的装载清单；未装载的项目范围不凭空造。 */
function projectScopeKey(projectId: string | null): string | null {
  return projectId === null ? null : `project:${projectId}`;
}

/** 把一行加进它所属的项目范围（若那个范围已装载）。 */
function indexProjectScope(draft: TasksState, task: Task): void {
  const scope = projectScopeKey(task.projectId);
  if (scope === null || draft.scopes[scope] === undefined) return;
  if (!draft.scopes[scope].includes(task.id)) draft.scopes[scope] = [...draft.scopes[scope], task.id];
}

/** 把一行从某个项目范围里摘掉。 */
function unindexProjectScope(draft: TasksState, task: Task): void {
  const scope = projectScopeKey(task.projectId);
  if (scope === null || draft.scopes[scope] === undefined) return;
  draft.scopes[scope] = draft.scopes[scope].filter((id) => id !== task.id);
}

function indexChild(draft: TasksState, parentId: string, childId: string): void {
  const siblings = draft.childrenByParent[parentId] ?? [];
  if (!siblings.includes(childId)) {
    draft.childrenByParent[parentId] = [...siblings, childId];
  }
}

function unindexChild(draft: TasksState, parentId: string, childId: string): void {
  const siblings = draft.childrenByParent[parentId];
  if (siblings) {
    draft.childrenByParent[parentId] = siblings.filter((id) => id !== childId);
  }
}

/** The row's parent changed (filed under another task, or promoted): move it. */
function moveChildIndex(
  draft: TasksState,
  childId: string,
  from: string | null,
  to: string | null,
): void {
  if (from === to) return;
  if (from !== null) unindexChild(draft, from, childId);
  if (to !== null) indexChild(draft, to, childId);
}

/** Puts one row in the table and in its parent's child index. */
function insertRow(draft: TasksState, task: Task): void {
  draft.byId[task.id] = task;
  if (task.parentTaskId !== null) indexChild(draft, task.parentTaskId, task.id);
}

/**
 * Installs one scope page. `append` continues a paged scope (the cursor walks
 * forward); otherwise the scope's id list is replaced by this page's rows.
 *
 * `children` never enters the render list: a child that both matched the
 * predicate and rides under its parent would otherwise be listed twice.
 */
export function installPage(scope: string, page: TaskPage, append: boolean): void {
  setState(
    produce((draft: TasksState) => {
      for (const task of page.rows) insertRow(draft, task);
      for (const task of page.children) insertRow(draft, task);
      for (const ref of page.related) draft.related[ref.id] = ref;
      // 这一页对自己的 id 是权威的：行不再被阻塞时服务端根本不返回它，所以先清掉
      // 本页那些行的旧计数，再写回返回来的。
      for (const task of [...page.rows, ...page.children]) delete draft.blocked[task.id];
      for (const entry of page.blocked) draft.blocked[entry.taskId] = entry.count;

      const current = append ? (draft.scopes[scope] ?? []) : [];
      const merged = [...current];
      for (const task of page.rows) {
        if (!merged.includes(task.id)) merged.push(task.id);
      }
      draft.scopes[scope] = merged;

      draft.scopeMeta[scope] = {
        loaded: true,
        loading: false,
        hasMore: page.hasMore,
        cursor: page.cursor,
        error: null,
      };
      if (scope === "all") draft.loaded = true;
    }),
  );
}

// --- mutators (data-layer plumbing; see module docs) -------------------------

/** Transitional: the `task:list` snapshot fills the `all` scope. */
export function setAll(tasks: Task[], tags: Tag[]): void {
  setState(
    produce((draft: TasksState) => {
      draft.byId = {};
      draft.childrenByParent = {};
      for (const task of tasks) insertRow(draft, task);
      draft.scopes.all = tasks.map((task) => task.id);
      // 别的窗口新建的任务从这条路进来（快捷添加窗口有自己的 store，本窗口靠
      // `reloadTasks` 的整表快照得知），而 `ensureScope` 对已装载的范围短路，所以
      // 每个**已装载**的项目范围都从这份快照重新推导 id 列表：成员关系就是行的
      // `projectId` 一个字段，顺序就是快照自己的顺序。其余范围不动。
      for (const scope of Object.keys(draft.scopes)) {
        if (!scope.startsWith("project:")) continue;
        const projectId = scope.slice("project:".length);
        draft.scopes[scope] = tasks
          .filter((task) => task.projectId === projectId)
          .map((task) => task.id);
      }
      draft.tags = tags;
      draft.loaded = true;
      draft.scopeMeta.all = {
        loaded: true,
        loading: false,
        hasMore: false,
        cursor: null,
        error: null,
      };
    }),
  );
}

/** Replaces the whole edge set (the dependency load's own snapshot). */
export function setDependencies(dependencies: Dependency[]): void {
  setState("dependencies", dependencies);
}

/** Replaces the per-project unfinished counts (one aggregate load). */
export function setUnfinishedCounts(counts: ProjectUnfinished[]): void {
  setState(
    "unfinishedByProject",
    Object.fromEntries(counts.map((row) => [row.projectId, row.unfinished])),
  );
}

/** Adds one edge if it is not already there (optimistic insert). */
export function addDependencyEdge(edge: Dependency): void {
  setState(
    "dependencies",
    produce((list: Dependency[]) => {
      if (!list.some((item) => edgeEquals(item, edge))) list.push(edge);
    }),
  );
}

/** Removes one edge; missing edges are a no-op (optimistic delete). */
export function removeDependencyEdge(edge: Dependency): void {
  setState(
    "dependencies",
    produce((list: Dependency[]) => {
      const index = list.findIndex((item) => edgeEquals(item, edge));
      if (index !== -1) list.splice(index, 1);
    }),
  );
}

export function upsertTask(task: Task): void {
  setState(
    produce((draft: TasksState) => {
      const previous = draft.byId[task.id];
      const isNew = previous === undefined;
      if (previous && previous.parentTaskId !== task.parentTaskId) {
        moveChildIndex(draft, task.id, previous.parentTaskId, task.parentTaskId);
      }
      insertRow(draft, task);
      if (isNew) {
        indexProjectScope(draft, task);
        // Transitional: `all` feeds the views, so a brand-new row (the optimistic
        // create) has to show up right away — even before any snapshot loaded,
        // exactly as it did when the store held a plain array.
        const ids = draft.scopes.all ?? [];
        if (!ids.includes(task.id)) draft.scopes.all = [...ids, task.id];
      } else if (previous.projectId !== task.projectId) {
        unindexProjectScope(draft, previous);
        indexProjectScope(draft, task);
      }
    }),
  );
}

export function patchTask(id: string, patch: Partial<Task>): void {
  setState(
    produce((draft: TasksState) => {
      const task = draft.byId[id];
      if (!task) return;
      const previousParent = task.parentTaskId;
      const previousProject = task.projectId;
      Object.assign(task, patch);
      if ("parentTaskId" in patch) {
        moveChildIndex(draft, id, previousParent, task.parentTaskId);
      }
      // A row that changed project leaves the old scope's list and joins the new
      // one. Same project (a full authoritative row arrives that way) is left
      // alone, or every edit would push the row to the end of a loaded scope.
      if ("projectId" in patch && previousProject !== task.projectId) {
        unindexProjectScope(draft, { ...task, projectId: previousProject });
        indexProjectScope(draft, task);
      }
    }),
  );
}

export function removeTask(id: string): void {
  setState(
    produce((draft: TasksState) => {
      const parentId = draft.byId[id]?.parentTaskId ?? null;
      delete draft.byId[id];
      if (parentId !== null) unindexChild(draft, parentId, id);
      for (const scope of Object.keys(draft.scopes)) {
        draft.scopes[scope] = draft.scopes[scope].filter((item) => item !== id);
      }
    }),
  );
}

/** Transitional: the soft-delete rollback puts a row back at its old index. */
export function insertTaskAt(index: number, task: Task): void {
  setState(
    produce((draft: TasksState) => {
      insertRow(draft, task);
      // Membership follows the row wherever it re-enters, this path included:
      // the rollback has to put it back in its project scope too, or it is
      // missing there until a forced reload.
      indexProjectScope(draft, task);
      const ids = draft.scopes.all ?? [];
      ids.splice(Math.min(Math.max(index, 0), ids.length), 0, task.id);
      draft.scopes.all = ids;
    }),
  );
}

/**
 * Installs the authoritative outcome of a reorder or board move: the moved row
 * plus every key the backend rewrote (a key-exhaustion rebalance rewrites the
 * whole scope). Order on screen comes from the client-side sort, so patching
 * the keys is enough — the scope's id list stays as it is.
 */
export function applyReorder(moved: Task, rebalanced: TaskKey[]): void {
  setState(
    produce((draft: TasksState) => {
      const previous = draft.byId[moved.id];
      if (previous && previous.parentTaskId !== moved.parentTaskId) {
        moveChildIndex(draft, moved.id, previous.parentTaskId, moved.parentTaskId);
      }
      insertRow(draft, moved);
      for (const row of rebalanced) {
        if (row.id === moved.id) continue;
        const task = draft.byId[row.id];
        if (task) task.sortOrder = row.sortOrder;
      }
    }),
  );
}

export function replaceTags(tags: Tag[]): void {
  setState("tags", tags);
}

export function upsertTag(tag: Tag): void {
  setState(
    "tags",
    produce((list: Tag[]) => {
      const index = list.findIndex((item) => item.id === tag.id);
      if (index === -1) {
        list.push(tag);
      } else {
        list[index] = tag;
      }
    }),
  );
}

export function patchTag(id: string, patch: Partial<Tag>): void {
  setState(
    "tags",
    produce((list: Tag[]) => {
      const tag = list.find((item) => item.id === id);
      if (tag) Object.assign(tag, patch);
    }),
  );
}

export function removeTag(id: string): void {
  setState("tags", (list) => list.filter((tag) => tag.id !== id));
}

export function insertTagAt(index: number, tag: Tag): void {
  setState(
    "tags",
    produce((list: Tag[]) => {
      list.splice(Math.min(Math.max(index, 0), list.length), 0, tag);
    }),
  );
}

export function setComments(taskId: string, comments: Comment[]): void {
  setState("commentsByTask", taskId, comments);
}

export function upsertComment(taskId: string, comment: Comment): void {
  setState("commentsByTask", taskId, (list) => {
    const index = list.findIndex((item) => item.id === comment.id);
    if (index === -1) return [...list, comment];
    return list.map((item) => (item.id === comment.id ? comment : item));
  });
}

export function patchComment(taskId: string, id: string, patch: Partial<Comment>): void {
  setState("commentsByTask", taskId, (list) =>
    list.map((item) => (item.id === id ? { ...item, ...patch } : item)),
  );
}

export function removeComment(taskId: string, id: string): void {
  setState("commentsByTask", taskId, (list) => list.filter((item) => item.id !== id));
}

export function setTimeEntries(taskId: string, entries: TimeEntry[]): void {
  setState("timeEntriesByTask", taskId, entries);
}

/** Inserts new entries at the head, keeping the newest-first list order. */
export function upsertTimeEntry(taskId: string, entry: TimeEntry): void {
  setState("timeEntriesByTask", taskId, (list) => {
    const index = list.findIndex((item) => item.id === entry.id);
    if (index === -1) return [entry, ...list];
    return list.map((item) => (item.id === entry.id ? entry : item));
  });
}

export function patchTimeEntry(taskId: string, id: string, patch: Partial<TimeEntry>): void {
  setState("timeEntriesByTask", taskId, (list) =>
    list.map((item) => (item.id === id ? { ...item, ...patch } : item)),
  );
}

export function removeTimeEntry(taskId: string, id: string): void {
  setState("timeEntriesByTask", taskId, (list) => list.filter((item) => item.id !== id));
}

/** Resets the store to its pristine state (test seam). */
export function resetTasksStore(): void {
  setState(emptyState());
}
