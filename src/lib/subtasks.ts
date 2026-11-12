import type { Task } from "../model/types";
import { t } from "./i18n";

/** Children arrive sorted by sort_order; the current one is the first still open. */
export function currentSubtask(children: Task[]): Task | null {
  return children.find((child) => child.status !== "done") ?? null;
}

export function subtasksDone(children: Task[]): number {
  return children.filter((child) => child.status === "done").length;
}

/** The dim line under a task title: "当前子任务 · 写导出按钮". */
export function subtaskLabel(children: Task[]): string | null {
  const child = currentSubtask(children);
  return child ? `${t("task.currentSubtask")} · ${child.title}` : null;
}

/** The draft's child order first; children the draft does not know yet follow the stored order. */
export function orderSubtasks(children: Task[], order: string[]): Task[] {
  if (!order.length) return children;
  const byId = new Map(children.map((child) => [child.id, child]));
  const ordered: Task[] = [];
  for (const id of order) {
    const child = byId.get(id);
    if (child) {
      ordered.push(child);
      byId.delete(id);
    }
  }
  for (const child of children) if (byId.has(child.id)) ordered.push(child);
  return ordered;
}

/** The insertion slot a pointer over the row at `index` asks for: before or after it. */
export function subtaskDropSlot(
  index: number,
  pointerY: number,
  top: number,
  height: number,
): number {
  return index + (pointerY > top + height / 2 ? 1 : 0);
}

/**
 * Where a keyboard move lands: null means the edge (no move), otherwise the sibling to
 * place the task before, with `null` meaning the end of the list.
 */
export function subtaskMoveTarget(
  children: Task[],
  index: number,
  delta: -1 | 1,
): { beforeId: string | null } | null {
  const target = index + delta;
  if (index < 0 || target < 0 || target >= children.length) return null;
  return { beforeId: delta < 0 ? children[target].id : (children[target + 1]?.id ?? null) };
}
