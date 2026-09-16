/**
 * Which lane a card sits in (P-05).
 *
 * The board is a *view* over the project's tasks, not a second place they have
 * to be filed: every live task of the project shows in exactly one lane. 完成
 * is what puts a task in the done column — from the list's checkbox, the detail
 * dialog or a drop, all of them stamp `completedAt` — so a finished task shows
 * there without needing a write. An open task sits where its `columnId` says,
 * and one that has no column of its own (created in the list view, or left
 * behind by a column that has since been deleted) sits in the first open column
 * instead of vanishing from the board.
 *
 * Pure on purpose: the lane rules are the board's whole vocabulary, so they are
 * pinned by a table test rather than by rendering.
 */

import type { Task } from "../tasks/types";
import type { BoardColumn } from "./types";

/** Lanes in board order, with the done lane singled out. */
export interface Lanes {
  /** The column that means 已完成; the first done column, if any. */
  done: BoardColumn | undefined;
  /** The remaining columns, in position order. */
  open: BoardColumn[];
}

export function splitLanes(columns: readonly BoardColumn[]): Lanes {
  const done = columns.find((column) => column.isDone);
  return { done, open: columns.filter((column) => !column.isDone) };
}

/**
 * The lane `task` belongs to. Falls back to the first lane the project has, so
 * a task is never invisible: a completed task in a project whose done column is
 * gone lands in the first open column, and so does an open task whose column
 * was deleted.
 */
export function laneOf(task: Task, lanes: Lanes): BoardColumn | undefined {
  if (task.completedAt !== null) {
    return lanes.done ?? lanes.open[0];
  }
  const own = lanes.open.find((column) => column.id === task.columnId);
  return own ?? lanes.open[0] ?? lanes.done;
}
