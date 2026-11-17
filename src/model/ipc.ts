import { invoke } from "@tauri-apps/api/core";
import type {
  AiTestResult,
  ArchiveData,
  ArchiveTask,
  Bootstrap,
  CaptureFields,
  Category,
  Mode,
  OverdueTask,
  PassAction,
  Person,
  Priority,
  Issue,
  IssuePatch,
  Milestone,
  Project,
  ProjectDocument,
  ProjectDocumentDetail,
  ProjectGroup,
  ProjectNumbering,
  ProjectSummary,
  Requirement,
  RequirementChange,
  RequirementPatch,
  RequirementStatus,
  RuleInput,
  SearchHit,
  Settings,
  Status,
  ShortcutOutcome,
  StatsOverview,
  SubtaskPlan,
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

export function capture(
  title: string,
  fields: CaptureFields,
  newProjectName: string | null = null,
  done = false,
): Promise<Task> {
  return invoke<Task>("capture", { title, fields, newProjectName, done });
}

export function listWeek(): Promise<Task[]> {
  return invoke<Task[]>("list_week");
}

export function listAllTasks(): Promise<Task[]> {
  return invoke<Task[]>("list_all_tasks");
}

/** Task titles in every state plus live project names, for the global palette. */
export function searchAll(query: string): Promise<SearchHit[]> {
  return invoke<SearchHit[]>("search_all", { query });
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

/** Drops a task on a day: it joins the week with that expected start and order. */
export function placeTask(taskId: string, day: string, beforeId: string | null): Promise<void> {
  return invoke<void>("place_task", { taskId, day, beforeId });
}

/** Adds a subtask with the plan the sheet shows, and hands back the parent it rolls up. */
export function addSubtask(taskId: string, title: string, plan: SubtaskPlan): Promise<Task> {
  return invoke<Task>("add_subtask", { taskId, title, plan });
}

/** Drops a subtask and hands back the refreshed parent. */
export function deleteSubtask(subtaskId: string): Promise<Task> {
  return invoke<Task>("delete_subtask", { subtaskId });
}

/** Saves the sheet's subtask order; hands back the parent with its children in it. */
export function reorderSubtasks(taskId: string, ids: string[]): Promise<Task> {
  return invoke<Task>("reorder_subtasks", { taskId, ids });
}

export function passQueue(): Promise<Task[]> {
  return invoke<Task[]>("pass_queue");
}

export function passResolve(
  taskId: string,
  action: PassAction,
  parkUntil: string | null,
  parkReason: string | null,
  parkedOnId: string | null,
): Promise<Task> {
  return invoke<Task>("pass_resolve", { taskId, action, parkUntil, parkReason, parkedOnId });
}

/** Clears the pass for the week the page shows and returns that week's Monday. */
export function markPassDone(today: string): Promise<string> {
  return invoke<string>("mark_pass_done", { today });
}

export function weekStats(today: string): Promise<WeekStats> {
  return invoke<WeekStats>("week_stats", { today });
}

/** Tasks finished this week (or planned for it) that already left the week list. */
export function listWeekDone(today: string): Promise<Task[]> {
  return invoke<Task[]>("list_week_done", { today });
}

/** Completed / created / delayed work for one local date range. */
export function statsOverview(from: string, to: string): Promise<StatsOverview> {
  return invoke<StatsOverview>("stats_overview", { from, to });
}

export function listParked(): Promise<Task[]> {
  return invoke<Task[]>("list_parked");
}

/** Sets a task aside: why, when to look again, and who it waits on (all optional). */
export function parkTask(
  id: string,
  until: string | null,
  reason: string | null,
  personId: string | null,
): Promise<Task> {
  return invoke<Task>("park_task", { id, until, reason, personId });
}

export function resumeTask(id: string): Promise<Task> {
  return invoke<Task>("resume_task", { id });
}
export function startTask(id: string): Promise<Task> {
  return invoke<Task>("start_task", { id });
}

export function addDelayNote(id: string, reason: string): Promise<Task> {
  return invoke<Task>("add_delay_note", { id, reason });
}

/** Rewrites one delay record's reason; an empty string clears it. */
export function setDelayReason(delayId: string, reason: string): Promise<Task> {
  return invoke<Task>("set_delay_reason", { id: delayId, reason });
}

/** Moves the finish later, grows the estimate to match, and records why. */
export function deferTask(id: string, finish: string, reason: string): Promise<Task> {
  return invoke<Task>("defer_task", { id, finish, reason });
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
  numbering: ProjectNumbering,
): Promise<Project> {
  return invoke<Project>("update_project", { id, name, groupId, priority, numbering });
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

export function updateProjectGroup(
  id: string,
  name: string,
  contact: string | null,
  phone: string | null,
  note: string | null,
): Promise<void> {
  return invoke<void>("update_project_group", { id, name, contact, phone, note });
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

export function createMilestone(
  projectId: string,
  title: string,
  dueDate: string | null,
): Promise<Milestone> {
  return invoke<Milestone>("create_milestone", { projectId, title, dueDate });
}

export function renameMilestone(id: string, title: string): Promise<void> {
  return invoke<void>("rename_milestone", { id, title });
}

export function setMilestoneDate(id: string, dueDate: string | null): Promise<void> {
  return invoke<void>("set_milestone_date", { id, dueDate });
}

export function setMilestoneDone(id: string, done: boolean): Promise<void> {
  return invoke<void>("set_milestone_done", { id, done });
}

export function deleteMilestone(id: string): Promise<void> {
  return invoke<void>("delete_milestone", { id });
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

export function updatePerson(id: string, name: string, categoryIds: string[]): Promise<Person> {
  return invoke<Person>("update_person", { id, name, categoryIds });
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
export function listDoneTasks(query: string | null): Promise<ArchiveTask[]> {
  return invoke<ArchiveTask[]>("list_done_tasks", { query });
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

/** The undo of archiving: the task comes back with its status and times untouched. */
export function unarchiveTask(id: string): Promise<Task> {
  return invoke<Task>("unarchive_task", { id });
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

/** The overdue prompt's queue; empty when the setting is off. */
export function listOverdueTasks(): Promise<OverdueTask[]> {
  return invoke<OverdueTask[]>("list_overdue_tasks");
}

/** Switches worlds now; the next schedule point can switch again. */
export function setMode(mode: Mode): Promise<Settings> {
  return invoke<Settings>("set_mode", { mode });
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

export function listDefaultRequirementStatuses(): Promise<string[]> {
  return invoke<string[]>("list_default_requirement_statuses");
}

export function saveDefaultRequirementStatuses(names: string[]): Promise<string[]> {
  return invoke<string[]>("save_default_requirement_statuses", { names });
}

export function listRequirementStatuses(projectId: string): Promise<RequirementStatus[]> {
  return invoke<RequirementStatus[]>("list_requirement_statuses", { projectId });
}

export function saveRequirementStatuses(
  projectId: string,
  statuses: { id: string | null; name: string }[],
): Promise<RequirementStatus[]> {
  return invoke<RequirementStatus[]>("save_requirement_statuses", { projectId, statuses });
}

export function listRequirements(projectId: string): Promise<Requirement[]> {
  return invoke<Requirement[]>("list_requirements", { projectId });
}

export function createRequirement(projectId: string, title: string): Promise<Requirement> {
  return invoke<Requirement>("create_requirement", { projectId, title });
}

export function updateRequirement(id: string, patch: RequirementPatch): Promise<Requirement> {
  return invoke<Requirement>("update_requirement", { id, patch });
}

export function deleteRequirement(id: string): Promise<void> {
  return invoke<void>("delete_requirement", { id });
}

export function advanceRequirement(id: string): Promise<Requirement> {
  return invoke<Requirement>("advance_requirement", { id });
}

export function linkRequirementSection(requirementId: string, sectionId: string): Promise<void> {
  return invoke<void>("link_requirement_section", { requirementId, sectionId });
}

export function unlinkRequirementSection(requirementId: string, sectionId: string): Promise<void> {
  return invoke<void>("unlink_requirement_section", { requirementId, sectionId });
}

export function createRequirementFromSection(
  sectionId: string,
  title: string,
  quote: string,
): Promise<Requirement> {
  return invoke<Requirement>("create_requirement_from_section", { sectionId, title, quote });
}

export function createRequirementTask(requirementId: string, title: string): Promise<Task> {
  return invoke<Task>("create_requirement_task", { requirementId, title });
}

export function listRequirementChanges(requirementId: string): Promise<RequirementChange[]> {
  return invoke<RequirementChange[]>("list_requirement_changes", { requirementId });
}

export function listProjectDocuments(projectId: string): Promise<ProjectDocument[]> {
  return invoke<ProjectDocument[]>("list_project_documents", { projectId });
}

export function getDocument(id: string): Promise<ProjectDocumentDetail> {
  return invoke<ProjectDocumentDetail>("get_document", { id });
}

export function importDocument(
  projectId: string,
  fileName: string,
  fileBase64: string,
): Promise<ProjectDocument> {
  return invoke<ProjectDocument>("import_document", { projectId, fileName, fileBase64 });
}

export function deleteDocument(id: string): Promise<void> {
  return invoke<void>("delete_document", { id });
}

export function listIssues(projectId: string): Promise<Issue[]> {
  return invoke<Issue[]>("list_issues", { projectId });
}

export function createIssue(projectId: string, title: string): Promise<Issue> {
  return invoke<Issue>("create_issue", { projectId, title });
}

export function updateIssue(id: string, patch: IssuePatch): Promise<Issue> {
  return invoke<Issue>("update_issue", { id, patch });
}

export function deleteIssue(id: string): Promise<void> {
  return invoke<void>("delete_issue", { id });
}

export function createIssueTask(issueId: string, title: string): Promise<Task> {
  return invoke<Task>("create_issue_task", { issueId, title });
}
