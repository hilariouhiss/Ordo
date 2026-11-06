import {
  resumeTask,
  setTaskStatus,
  startTask,
  suspendTask,
  toggleStep,
  updateTaskPatch,
} from "../model/ipc";
import { t } from "../lib/i18n";
import type { Step, Task } from "../model/types";
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

  function toggleStepDone(step: Step): Promise<Task> {
    return toggleStep(step.id).then((updated) => {
      undoVM.pushUndo(t("undo.step", { title: step.title }), async () => {
        await toggleStep(step.id);
      });
      return updated;
    });
  }

  return { start, suspend, toggleDone, toggleStepDone };
}

export const taskRowVM = createTaskRowVM();
