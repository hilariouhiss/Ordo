/**
 * Backend calls for the task domain — the only place in this feature that
 * touches the IPC layer. Components never call these directly; they go
 * through `hooks.ts`, which owns the optimistic-update flow.
 */

import { COMMANDS, invokeCommand } from "../../common/ipc";
import type {
  NewSubtask,
  NewTag,
  NewTask,
  Subtask,
  Tag,
  Task,
  UpdateSubtask,
  UpdateTag,
  UpdateTask,
} from "./types";

// --- task:* ------------------------------------------------------------------

export function listTasks(): Promise<Task[]> {
  return invokeCommand(COMMANDS.task.list);
}

export function createTask(payload: NewTask): Promise<Task> {
  return invokeCommand(COMMANDS.task.create, { payload });
}

export function updateTask(taskId: string, payload: UpdateTask): Promise<Task> {
  return invokeCommand(COMMANDS.task.update, { taskId, payload });
}

export function completeTask(taskId: string): Promise<Task> {
  return invokeCommand(COMMANDS.task.complete, { taskId });
}

export function softDeleteTask(taskId: string): Promise<void> {
  return invokeCommand(COMMANDS.task.softDelete, { taskId });
}

export function restoreTask(taskId: string): Promise<Task> {
  return invokeCommand(COMMANDS.task.restore, { taskId });
}

// --- tag:* -------------------------------------------------------------------

export function listTags(): Promise<Tag[]> {
  return invokeCommand(COMMANDS.tag.list);
}

export function createTag(payload: NewTag): Promise<Tag> {
  return invokeCommand(COMMANDS.tag.create, { payload });
}

export function updateTag(tagId: string, payload: UpdateTag): Promise<Tag> {
  return invokeCommand(COMMANDS.tag.update, { tagId, payload });
}

export function deleteTag(tagId: string): Promise<void> {
  return invokeCommand(COMMANDS.tag.delete, { tagId });
}

// --- subtask:* ---------------------------------------------------------------

export function listSubtasks(taskId: string): Promise<Subtask[]> {
  return invokeCommand(COMMANDS.subtask.list, { taskId });
}

export function createSubtask(taskId: string, payload: NewSubtask): Promise<Subtask> {
  return invokeCommand(COMMANDS.subtask.create, { taskId, payload });
}

export function updateSubtask(
  subtaskId: string,
  payload: UpdateSubtask,
): Promise<Subtask> {
  return invokeCommand(COMMANDS.subtask.update, { subtaskId, payload });
}

export function completeSubtask(subtaskId: string, done: boolean): Promise<Subtask> {
  return invokeCommand(COMMANDS.subtask.complete, { subtaskId, done });
}

export function deleteSubtask(subtaskId: string): Promise<void> {
  return invokeCommand(COMMANDS.subtask.delete, { subtaskId });
}

/** `prev`/`next` are the sort keys around the target slot; returns the task's
 * full subtask list in its new authoritative order. */
export function reorderSubtask(
  subtaskId: string,
  prev: string | null,
  next: string | null,
): Promise<Subtask[]> {
  return invokeCommand(COMMANDS.subtask.reorder, { subtaskId, prev, next });
}
