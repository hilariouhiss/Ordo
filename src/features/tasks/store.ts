/**
 * Full-data task store (module-level `createStore`, mirroring the `ui.ts`
 * store conventions). Holds every live task/tag plus lazily cached subtask
 * lists; views derive their subsets from `tasksState`.
 *
 * Mutators below are the data layer's plumbing — components change state
 * through `hooks.ts`, never directly.
 */

import { createStore, produce } from "solid-js/store";
import type { Comment, Subtask, Tag, Task, TimeEntry } from "./types";

export interface TasksState {
  /** All live tasks, ordered by `sortOrder` as returned by `task:list`. */
  tasks: Task[];
  /** All live tags, ordered by name (case-insensitive). */
  tags: Tag[];
  /** Subtask cache per task, filled on demand by `loadSubtasks`. */
  subtasksByTask: Record<string, Subtask[]>;
  /** Comment cache per task, filled on demand by `loadComments`. */
  commentsByTask: Record<string, Comment[]>;
  /** Time-entry cache per task, filled on demand by `loadTimeEntries`;
   * most recent first, as `time:list` returns them. */
  timeEntriesByTask: Record<string, TimeEntry[]>;
  /** Whether the initial `loadAll` completed successfully. */
  loaded: boolean;
}

const [state, setState] = createStore<TasksState>({
  tasks: [],
  tags: [],
  subtasksByTask: {},
  commentsByTask: {},
  timeEntriesByTask: {},
  loaded: false,
});

/** Reactive store state; read from components, mutate through hooks. */
export const tasksState = state;

export function getTask(id: string): Task | undefined {
  return state.tasks.find((task) => task.id === id);
}

export function getTag(id: string): Tag | undefined {
  return state.tags.find((tag) => tag.id === id);
}

export function getSubtasks(taskId: string): Subtask[] {
  return state.subtasksByTask[taskId] ?? [];
}

/** Whether the task's subtask list has been loaded into the cache. */
export function hasSubtasks(taskId: string): boolean {
  return taskId in state.subtasksByTask;
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

/** Index of a task in the ordered list, or -1. */
export function taskIndex(id: string): number {
  return state.tasks.findIndex((task) => task.id === id);
}

// --- mutators (data-layer plumbing; see module docs) -------------------------

export function setAll(tasks: Task[], tags: Tag[]): void {
  setState({ tasks, tags, loaded: true });
}

export function upsertTask(task: Task): void {
  setState(
    "tasks",
    produce((list: Task[]) => {
      const index = list.findIndex((item) => item.id === task.id);
      if (index === -1) {
        list.push(task);
      } else {
        list[index] = task;
      }
    }),
  );
}

export function patchTask(id: string, patch: Partial<Task>): void {
  setState(
    "tasks",
    produce((list: Task[]) => {
      const task = list.find((item) => item.id === id);
      if (task) Object.assign(task, patch);
    }),
  );
}

export function removeTask(id: string): void {
  setState("tasks", (list) => list.filter((task) => task.id !== id));
}

export function insertTaskAt(index: number, task: Task): void {
  setState(
    "tasks",
    produce((list: Task[]) => {
      list.splice(Math.min(Math.max(index, 0), list.length), 0, task);
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

export function setSubtasks(taskId: string, subtasks: Subtask[]): void {
  setState("subtasksByTask", taskId, subtasks);
}

/**
 * Rebuilds the whole subtask cache from one bulk load. `taskIds` is the task
 * snapshot that load came from — not the live store — so the caller decides
 * which tasks the rebuild covers.
 *
 * Every id in `taskIds` gets an entry, empty when that task has no subtasks.
 * That is what `hasSubtasks` reads, and the task detail dialog uses it to
 * decide whether to fetch again — leaving a childless task without a key
 * would make every such dialog re-request data that is already in hand.
 *
 * The rebuild is blind: it replaces each covered task's array wholesale. Its
 * only caller is `loadAll`, which runs for the initial load (and the
 * post-import refresh) — the mid-session refresh (`reloadTasks`) deliberately
 * leaves the snapshot out — so a rebuild never lands on top of a write the
 * user just made from a row that was on screen. If a future refresh does have
 * to carry the snapshot again, skip tasks whose cache is already loaded
 * instead of merging: a merge would resurrect rows the user deleted.
 *
 * Note that `setState` MERGES this record per key rather than replacing it, so
 * a task deleted since the previous load keeps its stale entry — the whole
 * previous value survives, array included, so that stale array is not
 * necessarily empty. Each task in `taskIds` still has its array replaced
 * wholesale; nothing iterates the record's keys, and consumers look up live
 * task ids only.
 */
export function setSubtasksAll(subtasks: Subtask[], taskIds: string[]): void {
  const byTask: Record<string, Subtask[]> = {};
  for (const id of taskIds) byTask[id] = [];
  for (const subtask of subtasks) {
    (byTask[subtask.taskId] ??= []).push(subtask);
  }
  setState("subtasksByTask", byTask);
}

export function upsertSubtask(taskId: string, subtask: Subtask): void {
  setState(
    "subtasksByTask",
    taskId,
    produce((list: Subtask[]) => {
      if (!list) return; // cache not loaded yet; loadSubtasks will fetch
      const index = list.findIndex((item) => item.id === subtask.id);
      if (index === -1) {
        list.push(subtask);
      } else {
        list[index] = subtask;
      }
    }),
  );
}

export function patchSubtask(taskId: string, id: string, patch: Partial<Subtask>): void {
  setState(
    "subtasksByTask",
    taskId,
    produce((list: Subtask[]) => {
      const subtask = list?.find((item) => item.id === id);
      if (subtask) Object.assign(subtask, patch);
    }),
  );
}

export function removeSubtask(taskId: string, id: string): void {
  setState(
    "subtasksByTask",
    taskId,
    produce((list: Subtask[]) => {
      if (!list) return;
      const index = list.findIndex((item) => item.id === id);
      if (index !== -1) list.splice(index, 1);
    }),
  );
}

export function insertSubtaskAt(taskId: string, index: number, subtask: Subtask): void {
  setState(
    "subtasksByTask",
    taskId,
    produce((list: Subtask[]) => {
      if (!list) return;
      list.splice(Math.min(Math.max(index, 0), list.length), 0, subtask);
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
  setState({
    tasks: [],
    tags: [],
    subtasksByTask: {},
    commentsByTask: {},
    timeEntriesByTask: {},
    loaded: false,
  });
}
