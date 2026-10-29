import { setTaskStatus, startTask, suspendTask, toggleStep } from "../model/ipc";
import type { Task } from "../model/types";

export function createTaskRowVM() {
  function start(task: Task): Promise<Task> {
    return startTask(task.id);
  }

  function suspend(task: Task, until: string | null, reason: string | null): Promise<Task> {
    return suspendTask(task.id, until, reason);
  }

  function toggleDone(task: Task): Promise<Task> {
    return setTaskStatus(task.id, task.status === "done" ? "todo" : "done");
  }

  function toggleStepDone(stepId: string): Promise<Task> {
    return toggleStep(stepId);
  }

  return { start, suspend, toggleDone, toggleStepDone };
}

export const taskRowVM = createTaskRowVM();
