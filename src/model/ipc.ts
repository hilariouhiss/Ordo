import { invoke } from "@tauri-apps/api/core";
import type {
  ArchiveData,
  Bootstrap,
  Category,
  PassAction,
  Person,
  Project,
  ProjectSummary,
  Settings,
  Tag,
  Task,
  TaskFields,
  WeekStats,
} from "./types";

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
export function listProjects(): Promise<ProjectSummary[]> {
  return invoke<ProjectSummary[]>("list_projects");
}

export function getProject(id: string): Promise<Project> {
  return invoke<Project>("get_project", { id });
}

export function createProject(name: string, dueDate: string | null): Promise<Project> {
  return invoke<Project>("create_project", { name, dueDate });
}

export function updateProject(id: string, name: string, dueDate: string | null): Promise<Project> {
  return invoke<Project>("update_project", { id, name, dueDate });
}

export function archiveProject(id: string): Promise<void> {
  return invoke<void>("archive_project", { id });
}

export function restoreProject(id: string): Promise<void> {
  return invoke<void>("restore_project", { id });
}

export function deleteProject(id: string): Promise<void> {
  return invoke<void>("delete_project", { id });
}

export function addMember(
  projectId: string,
  personId: string | null,
  name: string | null,
): Promise<Person> {
  return invoke<Person>("add_member", { projectId, personId, name });
}

export function removeMember(projectId: string, personId: string): Promise<void> {
  return invoke<void>("remove_member", { projectId, personId });
}

export function ownerCandidates(projectId: string | null): Promise<Person[]> {
  return invoke<Person[]>("owner_candidates", { projectId });
}

export function listPeople(): Promise<Person[]> {
  return invoke<Person[]>("list_people");
}
export function getProjectSummary(id: string): Promise<ProjectSummary> {
  return invoke<ProjectSummary>("get_project_summary", { id });
}
export function listProjectTasks(projectId: string): Promise<Task[]> {
  return invoke<Task[]>("list_project_tasks", { projectId });
}
export function listArchive(query: string | null): Promise<ArchiveData> {
  return invoke<ArchiveData>("list_archive", { query });
}

export function archiveTask(id: string): Promise<Task> {
  return invoke<Task>("archive_task", { id });
}

export function restoreTask(id: string): Promise<Task> {
  return invoke<Task>("restore_task", { id });
}

export function deleteTask(id: string): Promise<void> {
  return invoke<void>("delete_task", { id });
}
export function getSettings(): Promise<Settings> {
  return invoke<Settings>("get_settings");
}

export function setSettings(patch: Partial<Settings>): Promise<Settings> {
  return invoke<Settings>("set_settings", { patch });
}

export function exportJson(): Promise<string> {
  return invoke<string>("export_json");
}

export function backupNow(): Promise<string> {
  return invoke<string>("backup_now");
}

export function createCategory(name: string): Promise<Category> {
  return invoke<Category>("create_category", { name });
}

export function renameCategory(id: string, name: string): Promise<void> {
  return invoke<void>("rename_category", { id, name });
}

export function deleteCategory(id: string): Promise<void> {
  return invoke<void>("delete_category", { id });
}

export function reorderCategories(ids: string[]): Promise<Category[]> {
  return invoke<Category[]>("reorder_categories", { ids });
}

export function createTag(name: string): Promise<Tag> {
  return invoke<Tag>("create_tag", { name });
}

export function deleteTag(id: string): Promise<void> {
  return invoke<void>("delete_tag", { id });
}
export function markNotificationsSeen(): Promise<void> {
  return invoke<void>("mark_notifications_seen");
}
