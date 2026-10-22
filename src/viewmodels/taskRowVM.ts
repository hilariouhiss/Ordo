import { setTaskStatus, startTask, suspendTask } from "../model/ipc";
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

  return { start, suspend, toggleDone };
}

export const taskRowVM = createTaskRowVM();
