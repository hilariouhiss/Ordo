/**
 * Backend calls for the task domain — the only place in this feature that
 * touches the IPC layer. Components never call these directly; they go
 * through `hooks.ts`, which owns the optimistic-update flow.
 */

import { COMMANDS, invokeCommand } from "../../common/ipc";
import type {
  Comment,
  Dependency,
  NewComment,
  NewSubtask,
  NewTag,
  NewTask,
  NewTimeEntry,
  Subtask,
  Tag,
  Task,
  TimeEntry,
  UpdateComment,
  UpdateSubtask,
  UpdateTag,
  UpdateTask,
  UpdateTimeEntry,
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

/** Every live subtask of every live task; backs the hierarchical list. */
export function listSubtasksAll(): Promise<Subtask[]> {
  return invokeCommand(COMMANDS.subtask.listAll);
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

// --- dependency:* ------------------------------------------------------------

/** Every live edge; the store derives blocked state from the full set. */
export function listDependencies(): Promise<Dependency[]> {
  return invokeCommand(COMMANDS.dependency.listAll);
}

/** Idempotent: an edge that already exists comes back unchanged. */
export function addDependency(payload: Dependency): Promise<Dependency> {
  return invokeCommand(COMMANDS.dependency.add, { payload });
}

/** Idempotent: removing an edge that is already gone is not an error. */
export function removeDependency(payload: Dependency): Promise<void> {
  return invokeCommand(COMMANDS.dependency.remove, { payload });
}

// --- comment:* ----------------------------------------------------------------

export function listComments(taskId: string): Promise<Comment[]> {
  return invokeCommand(COMMANDS.comment.list, { taskId });
}

export function createComment(taskId: string, payload: NewComment): Promise<Comment> {
  return invokeCommand(COMMANDS.comment.create, { taskId, payload });
}

export function updateComment(commentId: string, payload: UpdateComment): Promise<Comment> {
  return invokeCommand(COMMANDS.comment.update, { commentId, payload });
}

export function deleteComment(commentId: string): Promise<void> {
  return invokeCommand(COMMANDS.comment.delete, { commentId });
}

// --- time:* -------------------------------------------------------------------

export function listTimeEntries(taskId: string): Promise<TimeEntry[]> {
  return invokeCommand(COMMANDS.time.list, { taskId });
}

export function createTimeEntry(taskId: string, payload: NewTimeEntry): Promise<TimeEntry> {
  return invokeCommand(COMMANDS.time.create, { taskId, payload });
}

export function updateTimeEntry(
  entryId: string,
  payload: UpdateTimeEntry,
): Promise<TimeEntry> {
  return invokeCommand(COMMANDS.time.update, { entryId, payload });
}

export function deleteTimeEntry(entryId: string): Promise<void> {
  return invokeCommand(COMMANDS.time.delete, { entryId });
}

/** Starts the task's timer; a task already being timed returns its running
 * entry instead of stacking a second one. */
export function startTimeEntry(taskId: string): Promise<TimeEntry> {
  return invokeCommand(COMMANDS.time.start, { taskId });
}

export function stopTimeEntry(entryId: string): Promise<TimeEntry> {
  return invokeCommand(COMMANDS.time.stop, { entryId });
}
