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
import { pushError } from "../../common/stores/notifications";
import * as api from "./api";
import * as store from "./store";
import type {
  Comment,
  NewComment,
  NewSubtask,
  NewTag,
  NewTask,
  Subtask,
  Tag,
  Task,
  TimeEntry,
  UpdateComment,
  UpdateSubtask,
  UpdateTag,
  UpdateTask,
  UpdateTimeEntry,
  NewTimeEntry,
} from "./types";

/** Prefix for optimistic ids; never collides with backend UUIDs. */
const TEMP_PREFIX = "optimistic-";
let tempSeq = 0;

function nextTempId(): string {
  tempSeq += 1;
  return `${TEMP_PREFIX}${Date.now().toString(36)}-${tempSeq}`;
}

/** Normalizes any thrown value, surfaces it as an error notification. */
function reportFailure(error: unknown): null {
  const normalized = normalizeError(error);
  pushError(normalized.message, normalized.code);
  return null;
}

/** Applies `apply`, runs `action`, reconciles; rolls back + notifies on failure. */
async function optimistic<T>(
  apply: () => void,
  rollback: () => void,
  action: () => Promise<T>,
): Promise<T | null> {
  apply();
  try {
    return await action();
  } catch (error) {
    rollback();
    return reportFailure(error);
  }
}

function missingEntity(what: string): null {
  pushError(`${what}不存在或数据已刷新，请重试`);
  return null;
}

// --- loading -----------------------------------------------------------------

/** Loads all tasks (with tagIds), tags and every subtask; returns success. */
export async function loadAll(): Promise<boolean> {
  try {
    const [tasks, tags, subtasks] = await Promise.all([
      api.listTasks(),
      api.listTags(),
      api.listSubtasksAll(),
    ]);
    // `setAll` first: `setSubtasksAll` seeds an entry per live task, so it has
    // to read the list this load just installed.
    store.setAll(tasks, tags);
    store.setSubtasksAll(subtasks);
    return true;
  } catch (error) {
    reportFailure(error);
    return false;
  }
}

/** Loads one task's subtasks into the cache; returns success. */
export async function loadSubtasks(taskId: string): Promise<boolean> {
  try {
    const subtasks = await api.listSubtasks(taskId);
    store.setSubtasks(taskId, subtasks);
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
      // The initial subtasks were inserted server-side, so their ids are not
      // in the response. Pull them now, or the new row would sit without a
      // disclosure control or a progress badge until someone opens its
      // detail. Fire-and-forget: the task itself must appear immediately.
      if (input.subtaskTitles?.length) void loadSubtasks(created.id);
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

  return optimistic(
    () => store.patchTask(taskId, optimisticPatch),
    () => store.patchTask(taskId, before),
    async () => {
      const saved = await api.updateTask(taskId, patch);
      store.patchTask(taskId, saved);
      return saved;
    },
  );
}

/** Stamps `completedAt` optimistically; the authoritative row reconciles it. */
export function completeTask(taskId: string): Promise<Task | null> {
  const current = store.getTask(taskId);
  if (!current) return Promise.resolve(missingEntity("任务"));
  const before: Task = { ...current };
  const now = new Date().toISOString();

  return optimistic(
    () => store.patchTask(taskId, { completedAt: now, updatedAt: now }),
    () => store.patchTask(taskId, before),
    async () => {
      const saved = await api.completeTask(taskId);
      store.patchTask(taskId, saved);
      return saved;
    },
  );
}

/** Un-completes a task (`completedAt: null` through task:update). */
export function uncompleteTask(taskId: string): Promise<Task | null> {
  return updateTask(taskId, { completedAt: null });
}

/** Soft-deletes a task; removed instantly, re-inserted at its position on failure. */
export function softDeleteTask(taskId: string): Promise<boolean | null> {
  const current = store.getTask(taskId);
  if (!current) return Promise.resolve(missingEntity("任务"));
  const snapshot: Task = { ...current };
  const index = store.taskIndex(taskId);

  return optimistic(
    () => store.removeTask(taskId),
    () => store.insertTaskAt(index, snapshot),
    async () => {
      await api.softDeleteTask(taskId);
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
    return restored;
  } catch (error) {
    return reportFailure(error);
  }
}

// --- tags --------------------------------------------------------------------

export function createTag(input: NewTag): Promise<Tag | null> {
  const tempId = nextTempId();
  const now = new Date().toISOString();
  const optimisticTag: Tag = {
    id: tempId,
    name: input.name.trim(),
    color: input.color ?? null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  return optimistic(
    () => store.upsertTag(optimisticTag),
    () => store.removeTag(tempId),
    async () => {
      const created = await api.createTag({ ...input, name: optimisticTag.name });
      store.removeTag(tempId);
      store.upsertTag(created);
      return created;
    },
  );
}

export function updateTag(tagId: string, patch: UpdateTag): Promise<Tag | null> {
  const current = store.getTag(tagId);
  if (!current) return Promise.resolve(missingEntity("标签"));
  const before: Tag = { ...current };

  const optimisticPatch: Partial<Tag> = { updatedAt: new Date().toISOString() };
  if (patch.name !== undefined) optimisticPatch.name = patch.name.trim();
  if ("color" in patch) optimisticPatch.color = patch.color ?? null;

  return optimistic(
    () => store.patchTag(tagId, optimisticPatch),
    () => store.patchTag(tagId, before),
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
  const affected: Array<{ taskId: string; tagIds: string[] }> = store.tasksState.tasks
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

// --- subtasks ----------------------------------------------------------------

/** Creates a subtask appended to the cached list (once that list is loaded). */
export function createSubtask(taskId: string, input: NewSubtask): Promise<Subtask | null> {
  const tempId = nextTempId();
  const now = new Date().toISOString();
  const title = input.title.trim();
  const optimisticSubtask: Subtask = {
    id: tempId,
    taskId,
    title,
    done: false,
    sortOrder: "\uffff",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  const cached = store.hasSubtasks(taskId);

  return optimistic(
    () => {
      if (cached) store.upsertSubtask(taskId, optimisticSubtask);
    },
    () => {
      if (cached) store.removeSubtask(taskId, tempId);
    },
    async () => {
      const created = await api.createSubtask(taskId, { title });
      if (cached) {
        store.removeSubtask(taskId, tempId);
        store.upsertSubtask(taskId, created);
      }
      return created;
    },
  );
}

export function updateSubtask(
  taskId: string,
  subtaskId: string,
  patch: UpdateSubtask,
): Promise<Subtask | null> {
  const current = store.getSubtasks(taskId).find((item) => item.id === subtaskId);
  if (!current) return Promise.resolve(missingEntity("子任务"));
  const before: Subtask = { ...current };

  const optimisticPatch: Partial<Subtask> = { updatedAt: new Date().toISOString() };
  if (patch.title !== undefined) optimisticPatch.title = patch.title.trim();
  if (patch.done !== undefined) optimisticPatch.done = patch.done;

  return optimistic(
    () => store.patchSubtask(taskId, subtaskId, optimisticPatch),
    () => store.patchSubtask(taskId, subtaskId, before),
    async () => {
      const saved = await api.updateSubtask(subtaskId, patch);
      store.patchSubtask(taskId, subtaskId, saved);
      return saved;
    },
  );
}

/** Checks/unchecks a subtask via the dedicated `subtask:complete` command. */
export function completeSubtask(
  taskId: string,
  subtaskId: string,
  done: boolean,
): Promise<Subtask | null> {
  const current = store.getSubtasks(taskId).find((item) => item.id === subtaskId);
  if (!current) return Promise.resolve(missingEntity("子任务"));
  const before: Subtask = { ...current };
  const now = new Date().toISOString();

  return optimistic(
    () => store.patchSubtask(taskId, subtaskId, { done, updatedAt: now }),
    () => store.patchSubtask(taskId, subtaskId, before),
    async () => {
      const saved = await api.completeSubtask(subtaskId, done);
      store.patchSubtask(taskId, subtaskId, saved);
      return saved;
    },
  );
}

export function deleteSubtask(taskId: string, subtaskId: string): Promise<boolean | null> {
  const list = store.getSubtasks(taskId);
  const index = list.findIndex((item) => item.id === subtaskId);
  if (index === -1) return Promise.resolve(missingEntity("子任务"));
  const snapshot: Subtask = { ...list[index] };

  return optimistic(
    () => store.removeSubtask(taskId, subtaskId),
    () => store.insertSubtaskAt(taskId, index, snapshot),
    async () => {
      await api.deleteSubtask(subtaskId);
      return true;
    },
  );
}

/**
 * Moves a subtask between `prev`/`next` sort keys (either side optional at
 * the ends). Reconciles with the full authoritative list, because a key
 * exhaustion rebalance rewrites neighbouring keys too.
 */
export function reorderSubtask(
  taskId: string,
  subtaskId: string,
  prev: string | null,
  next: string | null,
): Promise<Subtask[] | null> {
  const list = store.getSubtasks(taskId);
  const from = list.findIndex((item) => item.id === subtaskId);
  if (from === -1) return Promise.resolve(missingEntity("子任务"));
  const snapshot: Subtask[] = list.map((item) => ({ ...item }));

  // Optimistic target index within the list minus the moved item: after
  // `prev`, else before `next`, else the end.
  const others = list.filter((item) => item.id !== subtaskId);
  let target = others.length;
  if (prev !== null) {
    const i = others.findIndex((item) => item.sortOrder === prev);
    if (i !== -1) target = i + 1;
  } else if (next !== null) {
    const i = others.findIndex((item) => item.sortOrder === next);
    if (i !== -1) target = i;
  }

  return optimistic(
    () => store.setSubtasks(taskId, moveItem(list, from, target)),
    () => store.setSubtasks(taskId, snapshot),
    async () => {
      const saved = await api.reorderSubtask(subtaskId, prev, next);
      store.setSubtasks(taskId, saved);
      return saved;
    },
  );
}

/** Pure list move used by the optimistic step of `reorderSubtask`. */
function moveItem<T>(list: T[], from: number, to: number): T[] {
  const copy = [...list];
  const [item] = copy.splice(from, 1);
  copy.splice(Math.min(Math.max(to, 0), copy.length), 0, item);
  return copy;
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
  const before: Comment = { ...current };
  const body = patch.body.trim();

  return optimistic(
    () => store.patchComment(taskId, commentId, { body, updatedAt: new Date().toISOString() }),
    () => store.patchComment(taskId, commentId, before),
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
  const before: TimeEntry = { ...current };
  const optimisticPatch: Partial<TimeEntry> = { updatedAt: new Date().toISOString() };
  if (patch.startedAt !== undefined) optimisticPatch.startedAt = patch.startedAt;
  if (patch.duration !== undefined) {
    optimisticPatch.duration = patch.duration;
    const startedAt = patch.startedAt ?? current.startedAt;
    if (startedAt) optimisticPatch.endedAt = entryEnd(startedAt, patch.duration);
  }

  return optimistic(
    () => store.patchTimeEntry(taskId, entryId, optimisticPatch),
    () => store.patchTimeEntry(taskId, entryId, before),
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
      return running;
    },
  );
}

/** Stops a running timer, freezing the seconds elapsed since it started. */
export function stopTimer(taskId: string, entryId: string): Promise<TimeEntry | null> {
  const current = store.getTimeEntries(taskId).find((item) => item.id === entryId);
  if (!current) return Promise.resolve(missingEntity("时间记录"));
  const before: TimeEntry = { ...current };
  const stoppedAt = Date.now();
  const startedAt = current.startedAt ? Date.parse(current.startedAt) : stoppedAt;
  const stamp = new Date(stoppedAt).toISOString();

  return optimistic(
    () =>
      store.patchTimeEntry(taskId, entryId, {
        endedAt: stamp,
        duration: Math.max(0, Math.floor((stoppedAt - startedAt) / 1000)),
        updatedAt: stamp,
      }),
    () => store.patchTimeEntry(taskId, entryId, before),
    async () => {
      const stopped = await api.stopTimeEntry(entryId);
      store.patchTimeEntry(taskId, entryId, stopped);
      return stopped;
    },
  );
}
