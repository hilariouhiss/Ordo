import { parkTask, resumeTask, setTaskStatus, startTask, updateTaskPatch } from "../model/ipc";
import { todayIso } from "../lib/dates";
import type { ParkDraft } from "../lib/dialog";
import { t } from "../lib/i18n";
import type { Task } from "../model/types";
import { undoVM } from "./undoVM";

/** Puts the task back on the same park; a day already gone is dropped instead of refused. */
function repark(task: Task): Promise<Task> {
  const until = task.parkUntil && task.parkUntil >= todayIso() ? task.parkUntil : null;
  return parkTask(task.id, until, task.parkReason, task.parkedOnId);
}

export function createTaskRowVM() {
  function start(task: Task): Promise<Task> {
    return startTask(task.id);
  }

  function park(task: Task, draft: ParkDraft): Promise<Task> {
    return parkTask(task.id, draft.until || null, draft.reason || null, draft.personId).then(
      (updated) => {
        undoVM.pushUndo(t("undo.parked", { title: task.title }), async () => {
          await resumeTask(task.id);
        });
        return updated;
      },
    );
  }

  /** Back from a park. The undo puts the task back on the same park. */
  function resume(task: Task): Promise<Task> {
    return resumeTask(task.id).then((updated) => {
      undoVM.pushUndo(t("undo.resumed", { title: task.title }), async () => {
        await repark(task);
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
          // Completing clears the park; the undo puts the task back where it was.
          if (task.parked) {
            await repark(task);
            return;
          }
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

  return { start, park, resume, toggleDone, toggleSubtask };
}

export const taskRowVM = createTaskRowVM();
