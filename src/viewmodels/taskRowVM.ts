import {
  resumeTask,
  setTaskStatus,
  startTask,
  suspendTask,
  updateTaskPatch,
  waitTask,
} from "../model/ipc";
import { todayIso } from "../lib/dates";
import { t } from "../lib/i18n";
import type { Task } from "../model/types";
import { undoVM } from "./undoVM";

export function createTaskRowVM() {
  function start(task: Task): Promise<Task> {
    return startTask(task.id);
  }

  function suspend(task: Task, until: string | null, reason: string | null): Promise<Task> {
    return suspendTask(task.id, until, reason).then((updated) => {
      undoVM.pushUndo(t("undo.suspended", { title: task.title }), async () => {
        await resumeTask(task.id);
      });
      return updated;
    });
  }

  /**
   * Parks the task on a reply. The undo puts back what the wait replaced: a task that
   * was not waiting comes back to the week, one that was keeps its old person and day.
   * A day already gone is dropped instead of refused.
   */
  function wait(task: Task, personId: string | null, followUpDate: string | null): Promise<Task> {
    return waitTask(task.id, personId, followUpDate).then((updated) => {
      undoVM.pushUndo(t("undo.waiting", { title: task.title }), async () => {
        if (!task.waiting) {
          await resumeTask(task.id);
          return;
        }
        const day = task.followUpDate && task.followUpDate >= todayIso() ? task.followUpDate : null;
        await waitTask(task.id, task.waitingOnId, day);
      });
      return updated;
    });
  }

  /**
   * Back from a park. The undo puts the task where it came from: a suspended task is
   * parked again on the same day and reason, a waiting one keeps its person and day. A
   * date already gone is dropped instead of refused.
   */
  function resume(task: Task): Promise<Task> {
    return resumeTask(task.id).then((updated) => {
      undoVM.pushUndo(t("undo.resumed", { title: task.title }), async () => {
        if (task.waiting) {
          const day =
            task.followUpDate && task.followUpDate >= todayIso() ? task.followUpDate : null;
          await waitTask(task.id, task.waitingOnId, day);
          return;
        }
        const until =
          task.suspendedUntil && task.suspendedUntil >= todayIso() ? task.suspendedUntil : null;
        await suspendTask(task.id, until, task.suspendReason);
      });
      return updated;
    });
  }

  function toggleDone(task: Task): Promise<Task> {
    const previous = task.status;
    const next = previous === "done" ? "todo" : "done";
    return setTaskStatus(task.id, next).then((updated) => {
      undoVM.pushUndo(
        t(next === "done" ? "undo.completed" : "undo.reopened", { title: task.title }),
        async () => {
          await setTaskStatus(task.id, previous);
          // Re-completing stamps "now"; the undo of a reopen hands the recorded pair back.
          if (next === "todo" && task.actualStartAt && task.actualFinishAt) {
            await updateTaskPatch(task.id, {
              actualStartAt: task.actualStartAt,
              actualFinishAt: task.actualFinishAt,
            });
          }
        },
      );
      return updated;
    });
  }

  /** A subtask is a task: ticking it is a status change, and the parent rolls up. */
  function toggleSubtask(child: Task): Promise<Task> {
    const next = child.status === "done" ? "todo" : "done";
    return setTaskStatus(child.id, next).then((updated) => {
      undoVM.pushUndo(t("undo.subtask", { title: child.title }), async () => {
        await setTaskStatus(child.id, child.status);
      });
      return updated;
    });
  }

  return { start, suspend, wait, resume, toggleDone, toggleSubtask };
}

export const taskRowVM = createTaskRowVM();
