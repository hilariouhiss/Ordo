import { shortDate, todayIso } from "../lib/dates";
import { askNotice, dialogRequest } from "../lib/dialog";
import { t } from "../lib/i18n";
import { exclusiveConflict, type PlanTask } from "../lib/schedule";
import { listWeek } from "../model/ipc";
import type { Task } from "../model/types";

export function toPlanTask(task: Task): PlanTask {
  return {
    id: task.id,
    effortDays: task.effortDays,
    dueDate: task.dueDate,
    startDate: task.startDate,
    exclusive: task.exclusive,
  };
}

/** Tells the user once when exclusive time pushed a newly added task. */
export function warnExclusiveConflict(task: Task, weekTasks: Task[]): void {
  // A notice must not clobber a dialog the user is already answering.
  if (dialogRequest.value) return;
  const all = [...weekTasks.filter((one) => one.id !== task.id), task];
  const conflict = exclusiveConflict(toPlanTask(task), all.map(toPlanTask), todayIso());
  if (!conflict) return;
  const blocker = all.find((one) => one.id === conflict.taskId)?.title ?? "";
  void askNotice(
    t("week.exclusiveClashTitle"),
    t("week.exclusiveClash", {
      task: task.title,
      blocker,
      start: shortDate(conflict.start),
      end: shortDate(conflict.end),
      planned: shortDate(conflict.plannedStart),
    }),
  );
}

/** Same check when only the id is known (project page and the mini window event). */
export async function warnExclusiveConflictById(taskId: string): Promise<void> {
  if (dialogRequest.value) return;
  const week = await listWeek().catch(() => null);
  const task = week?.find((one) => one.id === taskId);
  if (week && task) warnExclusiveConflict(task, week);
}
