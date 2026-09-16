/**
 * Mutation entry points for the board domain — the surface components use.
 *
 * Every write follows the plan §3 optimistic data flow:
 * `用户动作 → 本地 store 乐观更新 → invoke 落库 → 后端权威结果 reconcile
 *  → 失败回滚 + 通知`. Moving a task mutates the *task* store (the board is
 * a view over tasks); column CRUD mutates this feature's column cache.
 */

import { normalizeError } from "../../common/ipc";
import { pushError } from "../../common/stores/notifications";
import { parkIfBlocked } from "../tasks/hooks";
import * as tasksStore from "../tasks/store";
import type { Task } from "../tasks/types";
import * as api from "./api";
import * as store from "./store";

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

/**
 * Temporary sort key for the optimistic step — good enough for one render
 * frame (`prev + NUL` sorts right after `prev`; `NUL + next` right before
 * `next`) and always replaced by the authoritative key on reconcile.
 */
function optimisticSortKey(prev: string | null, next: string | null, fallback: string): string {
  if (prev !== null) return `${prev}\u0000`;
  if (next !== null) return `\u0000${next}`;
  return fallback;
}

// --- loading -----------------------------------------------------------------

/** Loads one project's board columns into the cache; returns success. */
export async function loadColumns(projectId: string): Promise<boolean> {
  try {
    store.setColumns(projectId, await api.listBoardColumns(projectId));
    return true;
  } catch (error) {
    reportFailure(error);
    return false;
  }
}

// --- columns -----------------------------------------------------------------

// --- moving tasks ------------------------------------------------------------

/**
 * Drops a task into a column at the slot between `prev`/`next` sort keys
 * (either side optional at the ends). The optimistic step rewrites the
 * task's `columnId`/`projectId` and syncs `completedAt` with the column's
 * `is_done` flag — entering a done column stamps it, leaving one clears it;
 * the authoritative row reconciles everything, including the real sort key
 * (a backend rebalance may rewrite neighbouring keys too).
 *
 * Entering a done column *is* a completion (the backend stamps `completed_at`
 * and spawns the repeat instance), so it passes the same soft-block gate as the
 * other completion entry points before anything is written; confirming replays
 * this whole call, not just the completion.
 */
export function moveTaskToColumn(
  taskId: string,
  columnId: string,
  prev: string | null,
  next: string | null,
): Promise<Task | null> {
  const task = tasksStore.getTask(taskId);
  if (!task) return Promise.resolve(missingEntity("任务"));
  const column = store.getColumn(columnId);
  if (!column) return Promise.resolve(missingEntity("看板列"));

  const move = () => applyMove(taskId, columnId, prev, next);
  if (
    column.isDone &&
    task.completedAt === null &&
    parkIfBlocked(taskId, task.title, move)
  ) {
    return Promise.resolve(null);
  }
  return move();
}

/** The write itself: the first drop and the confirmed replay both land here. */
function applyMove(
  taskId: string,
  columnId: string,
  prev: string | null,
  next: string | null,
): Promise<Task | null> {
  const task = tasksStore.getTask(taskId);
  if (!task) return Promise.resolve(missingEntity("任务"));
  const column = store.getColumn(columnId);
  if (!column) return Promise.resolve(missingEntity("看板列"));
  const before: Task = { ...task };

  const now = new Date().toISOString();
  const optimisticPatch: Partial<Task> = {
    projectId: column.projectId,
    columnId,
    sortOrder: optimisticSortKey(prev, next, task.sortOrder),
    updatedAt: now,
  };
  if (column.isDone && task.completedAt === null) {
    optimisticPatch.completedAt = now;
  } else if (!column.isDone && task.completedAt !== null) {
    optimisticPatch.completedAt = null;
  }

  return optimistic(
    () => tasksStore.patchTask(taskId, optimisticPatch),
    () => tasksStore.patchTask(taskId, before),
    async () => {
      const result = await api.moveTask(taskId, columnId, prev, next);
      tasksStore.applyReorder(result.moved, result.rebalanced);
      return result.moved;
    },
  );
}
