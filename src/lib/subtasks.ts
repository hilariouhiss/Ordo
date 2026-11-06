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
