import { invoke } from "@tauri-apps/api/core";
import type { Bootstrap, Task, TaskFields } from "./types";

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
