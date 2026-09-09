/**
 * Pure derivation logic for the four task views (T-05): which tasks belong
 * to Inbox/Today/Upcoming/Completed, the shared filter/sort combinators,
 * and due-date presentation. Everything here is a pure function of its
 * inputs so tests can pin local-timezone boundaries with a fixed `now`
 * (plan §3: local day boundaries are the frontend's business).
 */

import { addDays, endOfDay, format, isSameDay } from "date-fns";
import { zhCN } from "date-fns/locale";
import type { Priority, Task } from "./types";

export type SortMode = "manual" | "priority" | "due" | "recent";

export interface TaskFilter {
  /** Single priority to keep, or "all". */
  priority: Priority | "all";
  /** Tag ids; a task matches when it carries at least one of them. Empty = no restriction. */
  tagIds: string[];
}

const PRIORITY_RANK: Record<Priority, number> = {
  high: 0,
  medium: 1,
  low: 2,
  none: 3,
};

/** Timestamp of an ISO string; `fallback` for null/invalid values. */
function epoch(iso: string | null, fallback: number): number {
  if (iso === null) return fallback;
  const time = new Date(iso).getTime();
  return Number.isNaN(time) ? fallback : time;
}

// --- view predicates ----------------------------------------------------------

export function isCompleted(task: Task): boolean {
  return task.completedAt !== null;
}

/** Inbox: uncompleted tasks without a project. */
export function viewInbox(tasks: readonly Task[]): Task[] {
  return tasks.filter((task) => task.projectId === null && !isCompleted(task));
}

/** Today: uncompleted tasks due by the end of the local day (overdue included). */
export function viewToday(tasks: readonly Task[], now: Date): Task[] {
  const bound = endOfDay(now).getTime();
  return tasks.filter(
    (task) => !isCompleted(task) && epoch(task.dueAt, Number.POSITIVE_INFINITY) <= bound,
  );
}

/** Upcoming: uncompleted tasks due after today within `days` days (local). */
export function viewUpcoming(tasks: readonly Task[], days: number, now: Date): Task[] {
  const start = endOfDay(now).getTime();
  const end = endOfDay(addDays(now, days)).getTime();
  return tasks.filter((task) => {
    if (isCompleted(task)) return false;
    const due = epoch(task.dueAt, Number.NaN);
    return due > start && due <= end;
  });
}

/** Completed: every task with a `completedAt` stamp. */
export function viewCompleted(tasks: readonly Task[]): Task[] {
  return tasks.filter(isCompleted);
}

// --- filter & sort ------------------------------------------------------------

export function applyFilter(tasks: readonly Task[], filter: TaskFilter): Task[] {
  return tasks.filter(
    (task) =>
      (filter.priority === "all" || task.priority === filter.priority) &&
      (filter.tagIds.length === 0 ||
        task.tagIds.some((id) => filter.tagIds.includes(id))),
  );
}

/** Mirrors the SQL `ORDER BY sort_order, created_at, id`. */
function compareManual(a: Task, b: Task): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder < b.sortOrder ? -1 : 1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function sortTasks(tasks: readonly Task[], mode: SortMode): Task[] {
  const copy = [...tasks];
  switch (mode) {
    case "priority":
      copy.sort(
        (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || compareManual(a, b),
      );
      break;
    case "due":
      copy.sort(
        (a, b) =>
          epoch(a.dueAt, Number.POSITIVE_INFINITY) - epoch(b.dueAt, Number.POSITIVE_INFINITY) ||
          compareManual(a, b),
      );
      break;
    case "recent":
      copy.sort(
        (a, b) =>
          epoch(b.completedAt, 0) - epoch(a.completedAt, 0) || compareManual(a, b),
      );
      break;
    default:
      copy.sort(compareManual);
  }
  return copy;
}

// --- due-date presentation ------------------------------------------------------

/** Whether the due date is already past (`due < now`). */
export function isOverdue(iso: string | null, now: Date): boolean {
  if (iso === null) return false;
  const due = new Date(iso).getTime();
  return !Number.isNaN(due) && due < now.getTime();
}

/** Human label for a due date: "今天 14:30", "明天 09:00", "9月12日 08:00". */
export function formatDueLabel(iso: string | null, now: Date): string {
  if (iso === null) return "";
  const due = new Date(iso);
  if (Number.isNaN(due.getTime())) return "";
  const day = isSameDay(due, now)
    ? "今天"
    : isSameDay(due, addDays(now, 1))
      ? "明天"
      : isSameDay(due, addDays(now, -1))
        ? "昨天"
        : format(due, "M月d日", { locale: zhCN });
  return `${day} ${format(due, "HH:mm")}`;
}
