/**
 * Full-data task store (module-level `createStore`, mirroring the `ui.ts`
 * store conventions). Holds every live task/tag plus lazily cached subtask
 * lists; views derive their subsets from `tasksState`.
 *
 * Mutators below are the data layer's plumbing — components change state
 * through `hooks.ts`, never directly.
 */

import { createStore, produce } from "solid-js/store";
import type { Subtask, Tag, Task } from "./types";

export interface TasksState {
  /** All live tasks, ordered by `sortOrder` as returned by `task:list`. */
  tasks: Task[];
  /** All live tags, ordered by name (case-insensitive). */
  tags: Tag[];
  /** Subtask cache per task, filled on demand by `loadSubtasks`. */
  subtasksByTask: Record<string, Subtask[]>;
  /** Whether the initial `loadAll` completed successfully. */
  loaded: boolean;
}

const [state, setState] = createStore<TasksState>({
  tasks: [],
  tags: [],
  subtasksByTask: {},
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

/** Resets the store to its pristine state (test seam). */
export function resetTasksStore(): void {
  setState({ tasks: [], tags: [], subtasksByTask: {}, loaded: false });
}
