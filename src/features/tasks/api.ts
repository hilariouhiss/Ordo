/**
 * Backend calls for the task domain — the only place in this feature that
 * touches the IPC layer. Components never call these directly; they go
 * through `hooks.ts`, which owns the optimistic-update flow.
 */

import { COMMANDS, invokeCommand } from "../../common/ipc";
import type {
  Reorder,
  Comment,
  Dependency,
  NewComment,
  NewTag,
  NewTask,
  NewTimeEntry,
  ProjectUnfinished,
  Tag,
  Task,
  TaskPage,
  TimeEntry,
  UpdateComment,
  UpdateTag,
  UpdateTask,
  UpdateTimeEntry,
} from "./types";

// --- task:* ------------------------------------------------------------------

export function listTasks(): Promise<Task[]> {
  return invokeCommand(COMMANDS.task.list);
}

/** One project's tasks as a scope page (`project:<id>`). */
export function listTasksByProject(projectId: string): Promise<TaskPage> {
  return invokeCommand(COMMANDS.task.listByProject, { projectId });
}

// --- project:* ---------------------------------------------------------------

/** Every live project's unfinished top-level task count — the sidebar arrows. */
export function listUnfinishedCounts(): Promise<ProjectUnfinished[]> {
  return invokeCommand(COMMANDS.project.unfinishedCounts);
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

/** Moves a task between its siblings; returns the sibling set in new order. */
export function reorderTask(
  taskId: string,
  prev: string | null,
  next: string | null,
): Promise<Reorder> {
  return invokeCommand(COMMANDS.task.reorder, { taskId, prev, next });
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

/** Every entry whose timer is on — one read for the whole task list. */
export function listRunningTimeEntries(): Promise<TimeEntry[]> {
  return invokeCommand(COMMANDS.time.running);
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
