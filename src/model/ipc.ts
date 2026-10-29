import { invoke } from "@tauri-apps/api/core";
import type {
  AiTestResult,
  ArchiveData,
  Bootstrap,
  CaptureFields,
  Category,
  PassAction,
  Person,
  Priority,
  Project,
  ProjectGroup,
  ProjectSummary,
  RuleInput,
  Settings,
  Status,
  ShortcutOutcome,
  Tag,
  Task,
  TaskPatch,
  TaskRule,
  TaskTemplate,
  TemplateInput,
  WeekStats,
} from "./types";

export function bootstrap(): Promise<Bootstrap> {
  return invoke<Bootstrap>("bootstrap");
}

export function capture(title: string, fields: CaptureFields): Promise<Task> {
  return invoke<Task>("capture", { title, fields });
}

export function listWeek(): Promise<Task[]> {
  return invoke<Task[]>("list_week");
}

export function listAllTasks(): Promise<Task[]> {
  return invoke<Task[]>("list_all_tasks");
}

export function getTask(id: string): Promise<Task> {
  return invoke<Task>("get_task", { id });
}

export function updateTaskPatch(id: string, patch: TaskPatch): Promise<Task> {
  return invoke<Task>("update_task", { id, patch });
}

export function moveTask(taskId: string, beforeId: string | null): Promise<Task[]> {
  return invoke<Task[]>("move_task", { taskId, beforeId });
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
  suspendReason: string | null,
): Promise<Task> {
  return invoke<Task>("pass_resolve", { taskId, action, suspendUntil, suspendReason });
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
export function startTask(id: string): Promise<Task> {
  return invoke<Task>("start_task", { id });
}
export function suspendTask(
  id: string,
  until: string | null,
  reason: string | null,
): Promise<Task> {
  return invoke<Task>("suspend_task", { id, until, reason });
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

export function createProject(name: string): Promise<Project> {
  return invoke<Project>("create_project", { name });
}

export function updateProject(
  id: string,
  name: string,
  groupId: string | null,
  priority: Priority,
): Promise<Project> {
  return invoke<Project>("update_project", { id, name, groupId, priority });
}

export function setProjectGroup(id: string, groupId: string): Promise<void> {
  return invoke<void>("set_project_group", { id, groupId });
}

export function listProjectGroups(): Promise<ProjectGroup[]> {
  return invoke<ProjectGroup[]>("list_project_groups");
}

export function createProjectGroup(name: string): Promise<ProjectGroup> {
  return invoke<ProjectGroup>("create_project_group", { name });
}

export function renameProjectGroup(id: string, name: string): Promise<void> {
  return invoke<void>("rename_project_group", { id, name });
}

export function deleteProjectGroup(id: string): Promise<void> {
  return invoke<void>("delete_project_group", { id });
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

export function setMemberCategory(
  projectId: string,
  personId: string,
  categoryId: string | null,
): Promise<Project> {
  return invoke<Project>("set_member_category", { projectId, personId, categoryId });
}

export function ownerCandidates(projectId: string | null): Promise<Person[]> {
  return invoke<Person[]>("owner_candidates", { projectId });
}

export function listPeople(): Promise<Person[]> {
  return invoke<Person[]>("list_people");
}

export function createPerson(name: string): Promise<Person> {
  return invoke<Person>("create_person", { name });
}

export function renamePerson(id: string, name: string): Promise<Person> {
  return invoke<Person>("rename_person", { id, name });
}

export function deletePerson(id: string): Promise<void> {
  return invoke<void>("delete_person", { id });
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
export function listRules(): Promise<TaskRule[]> {
  return invoke<TaskRule[]>("list_rules");
}

export function saveRule(rule: RuleInput): Promise<TaskRule> {
  return invoke<TaskRule>("save_rule", { rule });
}

export function setRuleEnabled(id: string, enabled: boolean): Promise<TaskRule> {
  return invoke<TaskRule>("set_rule_enabled", { id, enabled });
}

export function deleteRule(id: string): Promise<void> {
  return invoke<void>("delete_rule", { id });
}

export function listTemplates(): Promise<TaskTemplate[]> {
  return invoke<TaskTemplate[]>("list_templates");
}

export function saveTemplate(template: TemplateInput): Promise<TaskTemplate> {
  return invoke<TaskTemplate>("save_template", { template });
}

export function deleteTemplate(id: string): Promise<void> {
  return invoke<void>("delete_template", { id });
}

export function createTaskFromTemplate(templateId: string): Promise<Task> {
  return invoke<Task>("create_task_from_template", { templateId });
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
export function setShortcut(next: string): Promise<ShortcutOutcome> {
  return invoke<ShortcutOutcome>("set_shortcut", { next });
}

export function setDeskShortcut(next: string): Promise<ShortcutOutcome> {
  return invoke<ShortcutOutcome>("set_desk_shortcut", { next });
}

export function setMainShortcut(next: string): Promise<ShortcutOutcome> {
  return invoke<ShortcutOutcome>("set_main_shortcut", { next });
}
export function aiEnrich(taskId: string): Promise<void> {
  return invoke<void>("ai_enrich", { taskId });
}

export function aiTest(): Promise<AiTestResult> {
  return invoke<AiTestResult>("ai_test");
}

export function setAiKey(key: string): Promise<void> {
  return invoke<void>("set_ai_key", { key });
}

export function clearAiKey(): Promise<void> {
  return invoke<void>("clear_ai_key");
}

export function aiKeyStatus(): Promise<boolean> {
  return invoke<boolean>("ai_key_status");
}
export function setTaskStatus(id: string, status: Status): Promise<Task> {
  return invoke<Task>("set_status", { id, status });
}

/** True while the left mouse button is held; the desk widget waits for release before snapping. */
export function deskLeftButtonDown(): Promise<boolean> {
  return invoke<boolean>("desk_left_button_down");
}

/** One atomic native window rect change for the widget morph. */
export function setWindowRect(x: number, y: number, width: number, height: number): Promise<void> {
  return invoke<void>("set_window_rect", { x, y, width, height });
}
