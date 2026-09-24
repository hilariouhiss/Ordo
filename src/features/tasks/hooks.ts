/**
 * Mutation entry points for the task domain — the surface components use.
 *
 * Every write follows the plan §3 optimistic data flow:
 * `用户动作 → 本地 store 乐观更新 → invoke 落库 → 后端权威结果 reconcile
 *  → 失败回滚 + 通知`. Hooks return the authoritative entity on success and
 * `null` on failure (a notification is pushed already; callers need not
 * try/catch).
 */

import { normalizeError } from "../../common/ipc";
import {
  missingEntity,
  nextTempId,
  optimistic,
  patchRollback,
  reportFailure,
} from "../../common/optimistic";
import { randomColor } from "../../common/colors";
import * as api from "./api";
import { requestBlockedConfirm } from "./blocked-confirm";
import { blockersOf, buildIndex, completionSet, edgeEquals, liveSet } from "./dependencies";
import * as store from "./store";
import type {
  Comment,
  Dependency,
  NewComment,
  NewTag,
  NewTask,
  Tag,
  Task,
  TaskPage,
  TimeEntry,
  UpdateComment,
  UpdateTag,
  UpdateTask,
  UpdateTimeEntry,
  NewTimeEntry,
} from "./types";

// --- loading -----------------------------------------------------------------

/** 装载中的范围：并发调用复用同一个请求（导航重挂载会同时发起两次）。 */
const inFlightScopes = new Map<string, Promise<boolean>>();

/**
 * Guarantees a scope is loaded: already loaded returns at once, a call in flight
 * is reused, otherwise the loader runs once and its page is installed. A failure
 * lands in `scopeMeta.error` (the view's retry reads it) and leaves the scope
 * unloaded, so the next call retries. `force` is the retry button's path: it
 * re-runs the loader even for a scope that already loaded.
 */
export function ensureScope(
  scope: string,
  load: () => Promise<TaskPage>,
  force = false,
): Promise<boolean> {
  if (!force && store.scopeMetaOf(scope).loaded) return Promise.resolve(true);
  const running = inFlightScopes.get(scope);
  if (running) return running;

  const request = (async () => {
    store.markScopeLoading(scope, true);
    try {
      store.installPage(scope, await load(), false);
      return true;
    } catch (error) {
      const failure = normalizeError(error);
      store.markScopeError(scope, failure.message);
      return false;
    } finally {
      inFlightScopes.delete(scope);
    }
  })();

  inFlightScopes.set(scope, request);
  return request;
}

/** 计数请求序号：迟到的响应不许覆盖新的（同时会有多笔写）。 */
let unfinishedSeq = 0;

/**
 * 侧边栏的每项目未完成计数（`project:unfinishedCounts`，一条聚合）。它也是
 * 「该项目还有没有未完成项」的唯一口径——前端不从快照里数，只在可能改变这个
 * 数字的写之后重取一次。
 */
export async function loadUnfinishedCounts(): Promise<boolean> {
  const request = ++unfinishedSeq;
  try {
    const counts = await api.listUnfinishedCounts();
    if (request !== unfinishedSeq) return true;
    store.setUnfinishedCounts(counts);
    return true;
  } catch (error) {
    reportFailure(error);
    return false;
  }
}

/** 在途的整表装载：外壳与首个视图在启动时各发一次，复用同一笔请求（QA-17）。 */
let inFlightLoadAll: Promise<boolean> | null = null;

/**
 * Loads all tasks (children included, with tagIds), tags and every dependency
 * edge; returns success.
 *
 * Concurrent callers share one round trip: the shell and the first view both
 * ask on mount, and neither has set `loaded` yet when the other asks. A settled
 * load is not cached — the next call is a real reload.
 */
export function loadAll(): Promise<boolean> {
  inFlightLoadAll ??= runLoadAll().finally(() => {
    inFlightLoadAll = null;
  });
  return inFlightLoadAll;
}

async function runLoadAll(): Promise<boolean> {
  try {
    const [tasks, tags, dependencies] = await Promise.all([
      api.listTasks(),
      api.listTags(),
      api.listDependencies(),
    ]);
    // All four fields now arrive in this load's own snapshot: the tree is one
    // flat task list, so there is no second collection to seed.
    store.setAll(tasks, tags);
    store.setDependencies(dependencies);
    return true;
  } catch (error) {
    reportFailure(error);
    return false;
  }
}

/**
 * Re-reads tasks and tags; returns success. This is the mid-session refresh:
 * the quick-add window files a task through its own store, so this window has
 * to pull the list again.
 *
 * The task snapshot carries the whole tree (children are rows in `tasks`), so
 * a refresh is enough to pick up a child written elsewhere — no separate
 * hierarchy load exists to go stale.
 */
export async function reloadTasks(): Promise<boolean> {
  try {
    const [tasks, tags] = await Promise.all([api.listTasks(), api.listTags()]);
    store.setAll(tasks, tags);
    return true;
  } catch (error) {
    reportFailure(error);
    return false;
  }
}

// --- tasks -------------------------------------------------------------------

/** Creates a task; a temporary entry appears instantly and is replaced by
 * the authoritative row once the backend replies. */
export function createTask(input: NewTask): Promise<Task | null> {
  const tempId = nextTempId();
  const now = new Date().toISOString();
  const title = input.title.trim();
  const optimisticTask: Task = {
    id: tempId,
    projectId: input.projectId ?? null,
    title,
    note: input.note ?? null,
    priority: input.priority ?? "none",
    columnId: input.columnId ?? null,
    dueAt: input.dueAt ?? null,
    completedAt: null,
    repeatRule: null,
    complexity: input.complexity ?? null,
    parentTaskId: input.parentTaskId ?? null,
    tagIds: input.tagIds ? [...input.tagIds] : [],
    // Backend assigns the real key; "\uffff" keeps the temp entry last when
    // a view re-sorts by sortOrder.
    sortOrder: "\uffff",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  return optimistic(
    () => store.upsertTask(optimisticTask),
    () => store.removeTask(tempId),
    async () => {
      const created = await api.createTask({ ...input, title });
      store.removeTask(tempId);
      store.upsertTask(created);
      void loadUnfinishedCounts();
      // The initial subtasks were inserted server-side as child rows with ids
      // the response cannot carry. Pull the list again so the new row gets its
      // disclosure control right away. Fire-and-forget: the task itself must
      // appear immediately.
      if (input.subtaskTitles?.length) void reloadTasks();
      return created;
    },
  );
}

/** Applies a partial patch optimistically (missing = unchanged, null = clear). */
export function updateTask(taskId: string, patch: UpdateTask): Promise<Task | null> {
  const current = store.getTask(taskId);
  if (!current) return Promise.resolve(missingEntity("任务"));
  const before: Task = { ...current };

  const optimisticPatch: Partial<Task> = { updatedAt: new Date().toISOString() };
  if (patch.title !== undefined) optimisticPatch.title = patch.title.trim();
  if ("note" in patch) optimisticPatch.note = patch.note ?? null;
  if (patch.priority !== undefined) optimisticPatch.priority = patch.priority;
  if ("projectId" in patch) optimisticPatch.projectId = patch.projectId ?? null;
  if ("columnId" in patch) optimisticPatch.columnId = patch.columnId ?? null;
  if ("dueAt" in patch) optimisticPatch.dueAt = patch.dueAt ?? null;
  if ("completedAt" in patch) optimisticPatch.completedAt = patch.completedAt ?? null;
  if (patch.tagIds !== undefined) optimisticPatch.tagIds = [...patch.tagIds];
  if ("parentTaskId" in patch) optimisticPatch.parentTaskId = patch.parentTaskId ?? null;

  // Captured before the write: the store mutates the row in place, so a
  // snapshot taken inside the rollback would read the optimistic values back.
  const rollback = patchRollback(current, optimisticPatch);
  return optimistic(
    () => store.patchTask(taskId, optimisticPatch),
    () => store.patchTask(taskId, rollback),
    async () => {
      const saved = await api.updateTask(taskId, patch);
      store.patchTask(taskId, saved);
      // 只有可能改变「谁还算未完成顶层行」的改动才重取：纯标题/备注/标签/
      // 优先级/复杂度编辑与排序都不改变这个数。三个字段按**值**比而不是按「键在
      // 不在」比——编辑器 (TaskEditorDialog) 每次保存都带上任务自己的 `projectId`，
      // 按键比会让每次改名都白跑一趟聚合。`parentTaskId` 是例外，只看键：后端拿到它
      // 就把 `project_id` 改成父任务的项目、清掉 `column_id`，值没变也算数。
      if (
        "parentTaskId" in patch ||
        before.projectId !== saved.projectId ||
        before.completedAt !== saved.completedAt ||
        before.columnId !== saved.columnId
      ) {
        void loadUnfinishedCounts();
      }
      return saved;
    },
  );
}

/** Stamps `completedAt` optimistically; the authoritative row reconciles it. */
function applyCompleteTask(taskId: string): Promise<Task | null> {
  const current = store.getTask(taskId);
  if (!current) return Promise.resolve(missingEntity("任务"));
  const now = new Date().toISOString();
  const optimisticPatch: Partial<Task> = { completedAt: now, updatedAt: now };

  // Captured before the write: the store mutates the row in place, so a
  // snapshot taken inside the rollback would read the optimistic values back.
  const rollback = patchRollback(current, optimisticPatch);
  return optimistic(
    () => store.patchTask(taskId, optimisticPatch),
    () => store.patchTask(taskId, rollback),
    async () => {
      const saved = await api.completeTask(taskId);
      store.patchTask(taskId, saved);
      void loadUnfinishedCounts();
      return saved;
    },
  );
}

/**
 * The one soft-block gate. Completing something with an unfinished
 * prerequisite needs one confirmation first: the action is not refused (a
 * local single-user tool must not lock its owner out), but it does not happen
 * silently either. `run` is the *whole* action, so the host replays it without
 * knowing which entry point parked it — the board's drag, for instance, also
 * moves the card.
 *
 * A child task goes through this same gate: it is a task, and its edges live
 * in the one edge set.
 *
 * Returns `true` when the action was parked, in which case the caller must do
 * nothing else; `false` means it is not blocked and the caller runs `run`.
 */
export function parkIfBlocked(
  id: string,
  title: string,
  run: () => Promise<unknown>,
): boolean {
  const index = buildIndex(store.tasksState.dependencies, liveSet(store.tasks()));
  const done = completionSet(store.tasks());
  const blockers = blockersOf(index, done, id);
  if (blockers.length === 0) return false;
  requestBlockedConfirm({
    id,
    title,
    blockers: blockers.map((blockerId) => ({
      id: blockerId,
      title: titleOf(blockerId),
    })),
    run,
  });
  return true;
}

/** Title of a task by id, for the confirmation list. */
function titleOf(id: string): string {
  return store.getTask(id)?.title ?? "（已删除）";
}

export function completeTask(taskId: string): Promise<Task | null> {
  const current = store.getTask(taskId);
  if (!current) return Promise.resolve(missingEntity("任务"));
  const complete = () => forceCompleteTask(taskId);
  if (parkIfBlocked(taskId, current.title, complete)) {
    return Promise.resolve(null);
  }
  return complete();
}

/** Completion that skips the dependency check: the body of the action
 * `completeTask` parks for the confirmation host. */
export function forceCompleteTask(taskId: string): Promise<Task | null> {
  return applyCompleteTask(taskId);
}

/** Un-completes a task (`completedAt: null` through task:update). */
export function uncompleteTask(taskId: string): Promise<Task | null> {
  return updateTask(taskId, { completedAt: null });
}

/**
 * Soft-deletes a task; removed instantly, re-inserted at its position on
 * failure. The backend cascades to the children, so the optimistic step takes
 * them out in the same tick — leaving them on screen would show orphans until
 * the next load, and the rollback puts each one back.
 */
export function softDeleteTask(taskId: string): Promise<boolean | null> {
  const current = store.getTask(taskId);
  if (!current) return Promise.resolve(missingEntity("任务"));
  const snapshot: Task = { ...current };
  const children = store.childrenOf(taskId);
  // Each removed row together with the slot it left. `state.tasks` is kept in
  // `sortOrder` (that array order is what `topLevelTasks` hands out as the
  // manual order), so the rollback re-inserts rather than appends — and in
  // ascending index order, or a row clamped to the shortened array's end would
  // land after rows it used to precede.
  const removed = [
    { index: store.taskIndex(taskId), task: snapshot },
    ...children.map((task) => ({ index: store.taskIndex(task.id), task })),
  ].sort((a, b) => a.index - b.index);

  return optimistic(
    () => {
      store.removeTask(taskId);
      for (const child of children) store.removeTask(child.id);
    },
    () => {
      for (const { index, task } of removed) store.insertTaskAt(index, task);
    },
    async () => {
      await api.softDeleteTask(taskId);
      void loadUnfinishedCounts();
      return true;
    },
  );
}

/**
 * Restores a soft-deleted task. Not optimistic: deleted tasks are not part
 * of the store, so there is nothing to update until the authoritative row
 * arrives.
 */
export async function restoreTask(taskId: string): Promise<Task | null> {
  try {
    const restored = await api.restoreTask(taskId);
    store.upsertTask(restored);
    void loadUnfinishedCounts();
    // The server restored the children in the same transaction; the single
    // returned row cannot carry them, so pull the whole snapshot once more.
    // The edges come with it, and they have to: a live endpoint is what makes
    // an edge visible to `dependency:listAll`, so the restore just woke the
    // ones that were sleeping on this row (QA-09) — a task that depends on it
    // is blocked again as soon as the edge is back in the store.
    void loadAll();
    return restored;
  } catch (error) {
    return reportFailure(error);
  }
}

// --- ordering ----------------------------------------------------------------

/**
 * Moves a task between its siblings; reconciles the whole sibling set.
 *
 * The order is not something the client can infer optimistically: a rebalance
 * can hand the whole sibling group new sort keys, and the neighbours' rows
 * change with it. So this one skips the optimistic step and pastes the
 * authoritative set back into the store instead.
 */
export function reorderTask(
  taskId: string,
  prev: string | null,
  next: string | null,
): Promise<Task | null> {
  return optimistic(
    () => {},
    () => {},
    async () => {
      const result = await api.reorderTask(taskId, prev, next);
      // The backend owns both the keys and the order it rewrote; screen order
      // comes from the client-side sort, so patching the keys is enough.
      store.applyReorder(result.moved, result.rebalanced);
      return result.moved;
    },
  );
}

// --- tags --------------------------------------------------------------------

export function createTag(input: NewTag): Promise<Tag | null> {
  const tempId = nextTempId();
  const now = new Date().toISOString();
  // 未指定颜色（`undefined`）就随机一个；显式 `null`=「无颜色」保持无色（R3）。
  const color = input.color === undefined ? randomColor() : input.color;
  const optimisticTag: Tag = {
    id: tempId,
    name: input.name.trim(),
    color,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  return optimistic(
    () => store.upsertTag(optimisticTag),
    () => store.removeTag(tempId),
    async () => {
      const created = await api.createTag({ ...input, name: optimisticTag.name, color });
      store.removeTag(tempId);
      store.upsertTag(created);
      return created;
    },
  );
}

export function updateTag(tagId: string, patch: UpdateTag): Promise<Tag | null> {
  const current = store.getTag(tagId);
  if (!current) return Promise.resolve(missingEntity("标签"));

  const optimisticPatch: Partial<Tag> = { updatedAt: new Date().toISOString() };
  if (patch.name !== undefined) optimisticPatch.name = patch.name.trim();
  if ("color" in patch) optimisticPatch.color = patch.color ?? null;

  // Captured before the write: the store mutates the row in place, so a
  // snapshot taken inside the rollback would read the optimistic values back.
  const rollback = patchRollback(current, optimisticPatch);
  return optimistic(
    () => store.patchTag(tagId, optimisticPatch),
    () => store.patchTag(tagId, rollback),
    async () => {
      const saved = await api.updateTag(tagId, patch);
      store.patchTag(tagId, saved);
      return saved;
    },
  );
}

/** Soft-deletes a tag and strips it from every task's `tagIds` optimistically. */
export function deleteTag(tagId: string): Promise<boolean | null> {
  const current = store.getTag(tagId);
  if (!current) return Promise.resolve(missingEntity("标签"));
  const snapshot: Tag = { ...current };
  const index = store.tasksState.tags.findIndex((tag) => tag.id === tagId);
  const affected: Array<{ taskId: string; tagIds: string[] }> = store.tasks()
    .filter((task) => task.tagIds.includes(tagId))
    .map((task) => ({ taskId: task.id, tagIds: [...task.tagIds] }));

  return optimistic(
    () => {
      store.removeTag(tagId);
      for (const { taskId, tagIds } of affected) {
        store.patchTask(taskId, { tagIds: tagIds.filter((id) => id !== tagId) });
      }
    },
    () => {
      store.insertTagAt(index, snapshot);
      for (const { taskId, tagIds } of affected) {
        store.patchTask(taskId, { tagIds });
      }
    },
    async () => {
      await api.deleteTag(tagId);
      return true;
    },
  );
}

// --- comments ------------------------------------------------------------------

/** Loads one task's comments into the cache; returns success. */
export async function loadComments(taskId: string): Promise<boolean> {
  try {
    const comments = await api.listComments(taskId);
    store.setComments(taskId, comments);
    return true;
  } catch (error) {
    reportFailure(error);
    return false;
  }
}

/** Creates a comment appended to the cached list (once that list is loaded). */
export function createComment(taskId: string, input: NewComment): Promise<Comment | null> {
  const tempId = nextTempId();
  const now = new Date().toISOString();
  const body = input.body.trim();
  const optimisticComment: Comment = {
    id: tempId,
    taskId,
    body,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  const cached = store.hasComments(taskId);

  return optimistic(
    () => {
      if (cached) store.upsertComment(taskId, optimisticComment);
    },
    () => {
      if (cached) store.removeComment(taskId, tempId);
    },
    async () => {
      const created = await api.createComment(taskId, { body });
      if (cached) {
        store.removeComment(taskId, tempId);
        store.upsertComment(taskId, created);
      }
      return created;
    },
  );
}

export function updateComment(
  taskId: string,
  commentId: string,
  patch: UpdateComment,
): Promise<Comment | null> {
  const current = store.getComments(taskId).find((item) => item.id === commentId);
  if (!current) return Promise.resolve(missingEntity("评论"));
  const body = patch.body.trim();
  const optimisticPatch: Partial<Comment> = { body, updatedAt: new Date().toISOString() };

  // Captured before the write: the store mutates the row in place, so a
  // snapshot taken inside the rollback would read the optimistic values back.
  const rollback = patchRollback(current, optimisticPatch);
  return optimistic(
    () => store.patchComment(taskId, commentId, optimisticPatch),
    () => store.patchComment(taskId, commentId, rollback),
    async () => {
      const saved = await api.updateComment(commentId, { body });
      store.patchComment(taskId, commentId, saved);
      return saved;
    },
  );
}

export function deleteComment(taskId: string, commentId: string): Promise<boolean | null> {
  const list = store.getComments(taskId);
  const index = list.findIndex((item) => item.id === commentId);
  if (index === -1) return Promise.resolve(missingEntity("评论"));

  return optimistic(
    () => store.removeComment(taskId, commentId),
    () => store.setComments(taskId, [...list]),
    async () => {
      await api.deleteComment(commentId);
      return true;
    },
  );
}

// --- time entries ---------------------------------------------------------------

/**
 * Loads every running timer into the store — the 开始/暂停 state of each list
 * row, in one read. Called once at start-up rather than per view: the rows all
 * read this one snapshot, and `startTimer`/`stopTimer` keep it current after.
 */
export async function loadRunningTimers(): Promise<boolean> {
  try {
    store.setRunningTimers(await api.listRunningTimeEntries());
    return true;
  } catch (error) {
    reportFailure(error);
    return false;
  }
}

/** Loads one task's time entries into the cache; returns success. */
export async function loadTimeEntries(taskId: string): Promise<boolean> {
  try {
    const entries = await api.listTimeEntries(taskId);
    store.setTimeEntries(taskId, entries);
    return true;
  } catch (error) {
    reportFailure(error);
    return false;
  }
}

/** End instant derived from start + length, mirroring the backend's rule. */
function entryEnd(startedAt: string, duration: number): string {
  return new Date(Date.parse(startedAt) + duration * 1000).toISOString();
}

/** Records a manual entry, appended to the cache (once that cache is loaded). */
export function createTimeEntry(
  taskId: string,
  input: NewTimeEntry,
): Promise<TimeEntry | null> {
  const cached = store.hasTimeEntries(taskId);
  const now = new Date().toISOString();
  const optimisticEntry: TimeEntry = {
    id: nextTempId(),
    taskId,
    startedAt: input.startedAt,
    endedAt: entryEnd(input.startedAt, input.duration),
    duration: input.duration,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  return optimistic(
    () => {
      if (cached) store.upsertTimeEntry(taskId, optimisticEntry);
    },
    () => {
      if (cached) store.removeTimeEntry(taskId, optimisticEntry.id);
    },
    async () => {
      const created = await api.createTimeEntry(taskId, input);
      if (cached) {
        store.removeTimeEntry(taskId, optimisticEntry.id);
        store.upsertTimeEntry(taskId, created);
      }
      return created;
    },
  );
}

/** Edits a manual entry; the backend re-derives `endedAt` from start + length. */
export function updateTimeEntry(
  taskId: string,
  entryId: string,
  patch: UpdateTimeEntry,
): Promise<TimeEntry | null> {
  const current = store.getTimeEntries(taskId).find((item) => item.id === entryId);
  if (!current) return Promise.resolve(missingEntity("时间记录"));
  const optimisticPatch: Partial<TimeEntry> = { updatedAt: new Date().toISOString() };
  if (patch.startedAt !== undefined) optimisticPatch.startedAt = patch.startedAt;
  if (patch.duration !== undefined) {
    optimisticPatch.duration = patch.duration;
    const startedAt = patch.startedAt ?? current.startedAt;
    if (startedAt) optimisticPatch.endedAt = entryEnd(startedAt, patch.duration);
  }

  // Captured before the write: the store mutates the row in place, so a
  // snapshot taken inside the rollback would read the optimistic values back.
  const rollback = patchRollback(current, optimisticPatch);
  return optimistic(
    () => store.patchTimeEntry(taskId, entryId, optimisticPatch),
    () => store.patchTimeEntry(taskId, entryId, rollback),
    async () => {
      const saved = await api.updateTimeEntry(entryId, patch);
      store.patchTimeEntry(taskId, entryId, saved);
      return saved;
    },
  );
}

export function deleteTimeEntry(
  taskId: string,
  entryId: string,
): Promise<boolean | null> {
  const list = store.getTimeEntries(taskId);
  const index = list.findIndex((item) => item.id === entryId);
  if (index === -1) return Promise.resolve(missingEntity("时间记录"));

  return optimistic(
    () => store.removeTimeEntry(taskId, entryId),
    () => store.setTimeEntries(taskId, [...list]),
    async () => {
      await api.deleteTimeEntry(entryId);
      return true;
    },
  );
}

/** Starts a task's timer; a task already being timed keeps its running entry. */
export function startTimer(taskId: string): Promise<TimeEntry | null> {
  const cached = store.hasTimeEntries(taskId);
  const now = new Date().toISOString();
  const optimisticEntry: TimeEntry = {
    id: nextTempId(),
    taskId,
    startedAt: now,
    endedAt: null,
    duration: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  return optimistic(
    () => {
      if (cached) store.upsertTimeEntry(taskId, optimisticEntry);
    },
    () => {
      if (cached) store.removeTimeEntry(taskId, optimisticEntry.id);
    },
    async () => {
      const running = await api.startTimeEntry(taskId);
      if (cached) {
        store.removeTimeEntry(taskId, optimisticEntry.id);
        store.upsertTimeEntry(taskId, running);
      }
      // Only the real row reaches the shared running set. The optimistic entry
      // above carries a temp id, and a row button that paints 暂停 for it would
      // hand `stopTimer` an id the backend has never seen.
      store.setRunning(taskId, running);
      return running;
    },
  );
}

/** Stops a running timer, freezing the seconds elapsed since it started. */
export function stopTimer(taskId: string, entryId: string): Promise<TimeEntry | null> {
  const cached = store.hasTimeEntries(taskId);
  // Either cache can answer: the entry list when the task's detail has been
  // opened, the running set when the click came from a list row — which is the
  // common case, and one where `time:list` was deliberately never fetched.
  const current =
    store.getTimeEntries(taskId).find((item) => item.id === entryId) ??
    (store.runningEntryOf(taskId)?.id === entryId ? store.runningEntryOf(taskId) : undefined);
  if (!current) return Promise.resolve(missingEntity("时间记录"));
  const stoppedAt = Date.now();
  const startedAt = current.startedAt ? Date.parse(current.startedAt) : stoppedAt;
  const stamp = new Date(stoppedAt).toISOString();
  const optimisticPatch: Partial<TimeEntry> = {
    endedAt: stamp,
    duration: Math.max(0, Math.floor((stoppedAt - startedAt) / 1000)),
    updatedAt: stamp,
  };

  // Captured before the write: the store mutates the row in place, so a
  // snapshot taken inside the rollback would read the optimistic values back.
  const rollback = patchRollback(current, optimisticPatch);
  return optimistic(
    () => {
      if (cached) store.patchTimeEntry(taskId, entryId, optimisticPatch);
      store.setRunning(taskId, null);
    },
    () => {
      if (cached) store.patchTimeEntry(taskId, entryId, rollback);
      store.setRunning(taskId, current);
    },
    async () => {
      const stopped = await api.stopTimeEntry(entryId);
      if (cached) store.patchTimeEntry(taskId, entryId, stopped);
      store.setRunning(taskId, null);
      return stopped;
    },
  );
}

// --- dependencies ------------------------------------------------------------

/** Adds `dependent → prerequisite` optimistically; rolls back with a toast. */
export function addDependency(
  dependentId: string,
  prerequisiteId: string,
): Promise<boolean | null> {
  const edge: Dependency = { dependentId, prerequisiteId };
  const before = [...store.tasksState.dependencies];

  return optimistic(
    () => store.addDependencyEdge(edge),
    () => store.setDependencies(before),
    async () => {
      await api.addDependency(edge);
      return true;
    },
  );
}

export function removeDependency(
  dependentId: string,
  prerequisiteId: string,
): Promise<boolean | null> {
  const edge: Dependency = { dependentId, prerequisiteId };
  const before = [...store.tasksState.dependencies];
  // A second click on the same remove button, or an edge the last load already
  // hid, lands here. Removal is idempotent on the backend too, so the absent
  // edge is a success, not the "data has been refreshed" error.
  if (!before.some((item) => edgeEquals(item, edge))) return Promise.resolve(true);

  return optimistic(
    () => store.removeDependencyEdge(edge),
    () => store.setDependencies(before),
    async () => {
      await api.removeDependency(edge);
      return true;
    },
  );
}
