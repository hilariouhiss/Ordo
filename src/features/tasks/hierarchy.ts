/**
 * Hierarchy rules (R7c). One level deep: a task is either top-level or a child
 * of a top-level task — the service enforces that and is the authority, but the
 * drop target has to answer before the write, or a drop would light up and then
 * be refused.
 */

import { getTask, hasChildren } from "./store";
import type { Task } from "./types";

/**
 * Whether `childId` may be filed under `parent`. The rules are the service's,
 * restated here for the drop highlight: one level deep, no self-parenting, and
 * a task that already has children can never become a child itself.
 */
export function canAcceptChild(childId: string, parent: Task): boolean {
  if (childId === parent.id) return false;
  if (parent.parentTaskId !== null) return false;
  const child = getTask(childId);
  if (!child) return false;
  if (child.parentTaskId === parent.id) return false;
  return !hasChildren(childId);
}
