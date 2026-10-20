import { invoke } from "@tauri-apps/api/core";
import type { Bootstrap, PassAction, Task, TaskFields, WeekStats } from "./types";

export function bootstrap(): Promise<Bootstrap> {
  return invoke<Bootstrap>("bootstrap");
}

export function capture(raw: string): Promise<Task> {
  return invoke<Task>("capture", { raw });
}

export function listWeek(): Promise<Task[]> {
  return invoke<Task[]>("list_week");
}

export function getTask(id: string): Promise<Task> {
  return invoke<Task>("get_task", { id });
}

export function updateTask(id: string, fields: TaskFields): Promise<Task> {
  return invoke<Task>("update_task", { id, fields });
}

export function addStep(taskId: string, title: string): Promise<Task> {
  return invoke<Task>("add_step", { taskId, title });
}

export function toggleStep(stepId: string): Promise<Task> {
  return invoke<Task>("toggle_step", { stepId });
}

export function deleteStep(stepId: string): Promise<Task> {
  return invoke<Task>("delete_step", { stepId });
}

export function passQueue(): Promise<Task[]> {
  return invoke<Task[]>("pass_queue");
}

export function passResolve(
  taskId: string,
  action: PassAction,
  suspendUntil: string | null,
): Promise<Task> {
  return invoke<Task>("pass_resolve", { taskId, action, suspendUntil });
}

export function markPassDone(today: string): Promise<void> {
  return invoke<void>("mark_pass_done", { today });
}

export function weekStats(today: string): Promise<WeekStats> {
  return invoke<WeekStats>("week_stats", { today });
}

export function listSuspended(): Promise<Task[]> {
  return invoke<Task[]>("list_suspended");
}

export function resumeTask(id: string): Promise<Task> {
  return invoke<Task>("resume_task", { id });
}
export function setDue(id: string, newDue: string | null, reason: string | null): Promise<Task> {
  return invoke<Task>("set_due", { id, newDue, reason });
}

export function addDelayNote(id: string, reason: string): Promise<Task> {
  return invoke<Task>("add_delay_note", { id, reason });
}
