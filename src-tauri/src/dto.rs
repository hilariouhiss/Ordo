use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonDto {
    pub id: String,
    pub name: String,
    pub is_me: bool,
    /// The categories this person is responsible for; a project hands those tasks over.
    pub category_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryDto {
    pub id: String,
    pub name: String,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagDto {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsDto {
    /// "zh" or "en".
    pub language: String,
    pub ai_enabled: bool,
    pub ai_base_url: String,
    pub ai_model: String,
    pub shortcut: String,
    pub desk_shortcut: String,
    pub main_shortcut: String,
    pub autostart: bool,
    pub backup_keep_days: i64,
    pub backup_error: Option<String>,
    pub last_pass_week: String,
    pub shortcut_warning: Option<String>,
    pub desk_shortcut_warning: Option<String>,
    pub main_shortcut_warning: Option<String>,
    /// "light", "dark" or "system".
    pub theme: String,
    pub desk_enabled: bool,
    /// Whether the widget shows start / park / complete actions.
    pub desk_controls: bool,
    /// "top" or "bottom".
    pub desk_pin: String,
    /// Physical pixels of the expanded window's top-left corner.
    pub desk_x: Option<i64>,
    pub desk_y: Option<i64>,
    /// The task page grouping choice; "project" when unset.
    pub tasks_group_by: String,
    /// Whether the week page lists workdays the planner left empty.
    pub week_show_empty_days: bool,
    /// Whether finished tasks stay off the week page's list and gantt.
    pub week_hide_done: bool,
    /// The week page layout; "list" when unset.
    pub week_view: String,
    /// Whether a newly captured task starts exclusive.
    pub task_default_exclusive: bool,
    /// Whether an overdue task opens the defer prompt on startup / at 09:00.
    pub overdue_prompt: bool,
    /// Named task filters saved on the task page; empty when unset.
    pub saved_task_views: Vec<SavedTaskViewDto>,
    /// Minutes a reminder fires before a task's own moment; 0 keeps the built-in times.
    pub reminders_lead_minutes: i64,
    /// Whether the daily 09:00 digest fires.
    pub reminders_digest: bool,
    /// Whether the app checks for updates on startup and every six hours.
    pub updates_auto_check: bool,
    /// The mode the lists are filtered by; "work" when unset.
    pub mode: String,
    /// Whether the schedule switches the mode on its own.
    pub mode_auto: bool,
    /// Local "HH:MM" the schedule switches back to the company.
    pub mode_work_at: String,
    /// Local "HH:MM" the schedule switches to the personal world.
    pub mode_personal_at: String,
    /// ISO weekdays the schedule runs on, Monday = 1 … Sunday = 7.
    pub mode_days: Vec<u32>,
    /// Whether the notice shown after a manual mode switch was dismissed for good.
    pub mode_hint_dismissed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DelayDto {
    pub id: String,
    pub task_id: String,
    pub kind: String,
    pub old_due: Option<String>,
    pub new_due: Option<String>,
    pub reason: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDto {
    pub id: String,
    pub title: String,
    /// Set on a subtask: the task this one belongs to.
    pub parent_id: Option<String>,
    /// Display title of the parent, so a subtask card can name its umbrella.
    pub parent_title: Option<String>,
    pub project_id: Option<String>,
    /// Display name of the project, even when it is archived.
    pub project_name: Option<String>,
    pub category_id: Option<String>,
    pub owner_id: Option<String>,
    /// Local `YYYY-MM-DD` the work is planned to begin.
    pub expected_start_date: Option<String>,
    /// Local `YYYY-MM-DD` the work is planned to be finished.
    pub expected_finish_date: Option<String>,
    /// Local "HH:MM" a timed task is due; null for a plain day.
    pub expected_finish_time: Option<String>,
    /// RFC3339 UTC stamp of when the task actually started.
    pub actual_start_at: Option<String>,
    /// RFC3339 UTC stamp of when the task was actually finished.
    pub actual_finish_at: Option<String>,
    /// Minutes the work really took, filled in when the task is completed.
    pub actual_effort_minutes: Option<i64>,
    pub status: String,
    pub in_week: bool,
    pub carry_count: i64,
    /// Whether the task is set aside: parked, possibly on someone else's reply.
    pub parked: bool,
    /// Local `YYYY-MM-DD` the park started.
    pub parked_at: Option<String>,
    /// Local `YYYY-MM-DD` to look again; null means no reminder.
    pub park_until: Option<String>,
    pub park_reason: Option<String>,
    /// The person a parked task waits on, when it is someone else's reply.
    pub parked_on_id: Option<String>,
    pub note: Option<String>,
    pub archived_at: Option<String>,
    pub canceled_at: Option<String>,
    /// Live child tasks. A task with children is an umbrella: its own effort, dates and
    /// status are derived from them. Children never carry children of their own.
    pub children: Vec<TaskDto>,
    pub tags: Vec<TagDto>,
    pub delays: Vec<DelayDto>,
    pub created_at: String,
    pub updated_at: String,
    pub sort_order: i64,
    /// Minutes of work; 480 is one eight-hour day.
    pub effort_minutes: i64,
    pub priority: String,
    pub exclusive: bool,
    /// The requirement this task serves; a task serves at most one.
    pub requirement_id: Option<String>,
    /// The issue this task fixes; a task serves at most one.
    pub issue_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryProgressDto {
    pub category_id: String,
    pub name: String,
    pub total: i64,
    pub done: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummaryDto {
    pub id: String,
    pub name: String,
    pub group_id: Option<String>,
    pub priority: String,
    pub total: i64,
    pub done: i64,
    pub by_category: Vec<CategoryProgressDto>,
    pub milestones: Vec<MilestoneDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMemberDto {
    pub person_id: String,
    pub category_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDto {
    pub id: String,
    pub name: String,
    pub group_id: Option<String>,
    pub priority: String,
    pub archived_at: Option<String>,
    pub members: Vec<ProjectMemberDto>,
    /// How this project numbers new requirements, e.g. REQ-001.
    pub requirement_prefix: String,
    pub requirement_width: i64,
    /// How this project numbers new issues, e.g. ISS-001.
    pub issue_prefix: String,
    pub issue_width: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MilestoneDto {
    pub id: String,
    pub title: String,
    /// Local `YYYY-MM-DD`; null when the milestone has no day.
    pub due_date: Option<String>,
    /// RFC3339 UTC stamp of when it was marked done.
    pub done_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGroupDto {
    pub id: String,
    pub name: String,
    pub contact: Option<String>,
    pub phone: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapDto {
    pub people: Vec<PersonDto>,
    pub categories: Vec<CategoryDto>,
    pub tags: Vec<TagDto>,
    pub settings: SettingsDto,
    pub projects: Vec<ProjectSummaryDto>,
}

/// The fields the archive page shows; the full task loads when a row is opened.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveTaskDto {
    pub id: String,
    pub title: String,
    pub archived_at: Option<String>,
    pub canceled_at: Option<String>,
    /// When the work finished, shown beside a completed task.
    pub actual_finish_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveDto {
    pub projects: Vec<ProjectDto>,
    pub tasks: Vec<ArchiveTaskDto>,
    pub canceled: Vec<ArchiveTaskDto>,
}

/// One open task whose expected finish day has passed, for the overdue prompt.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverdueTaskDto {
    pub id: String,
    pub title: String,
    /// Local `YYYY-MM-DD` that has already passed.
    pub expected_finish_date: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeekStatsDto {
    pub added: i64,
    pub done: i64,
    pub delayed: i64,
}

/// One local day of the statistics page. Days without activity are left out;
/// the page fills the gaps so the chart keeps an even scale.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayStatsDto {
    /// Local `YYYY-MM-DD`.
    pub date: String,
    pub completed: i64,
    pub created: i64,
}

/// Completed work grouped by project or category. `id` and `name` stay null for
/// tasks that carry neither; the page names that bucket itself.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsSliceDto {
    pub id: Option<String>,
    pub name: Option<String>,
    pub completed: i64,
    pub minutes: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsOverviewDto {
    /// Local `YYYY-MM-DD` bounds, echoed back from the request.
    pub from: String,
    pub to: String,
    pub completed: i64,
    pub created: i64,
    pub completed_minutes: i64,
    /// Completions that landed on or before the expected finish day.
    pub on_time: i64,
    /// Completions that had an expected finish day; the on-time rate's denominator.
    pub with_due: i64,
    pub delayed: i64,
    pub daily: Vec<DayStatsDto>,
    pub by_project: Vec<StatsSliceDto>,
    pub by_category: Vec<StatsSliceDto>,
    /// The equally long window just before this one.
    pub previous_completed: i64,
    pub previous_minutes: i64,
    pub previous_on_time: i64,
    pub previous_with_due: i64,
    pub previous_delayed: i64,
}
/// A task edit. An absent field keeps its value; an explicit `null` clears it.
/// `title` and `tags` are not nullable, so absent keeps and a value replaces.
/// The expected finish and the three actual values are hand editable; a finish and
/// an effort move each other, and a finish needs an actual start to measure from.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPatch {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default, deserialize_with = "clearable")]
    pub project_id: Option<Option<String>>,
    #[serde(default, deserialize_with = "clearable")]
    pub category_id: Option<Option<String>>,
    #[serde(default, deserialize_with = "clearable")]
    pub owner_id: Option<Option<String>>,
    #[serde(default, deserialize_with = "clearable")]
    pub expected_start_date: Option<Option<String>>,
    #[serde(default, deserialize_with = "clearable")]
    pub expected_finish_date: Option<Option<String>>,
    #[serde(default, deserialize_with = "clearable")]
    pub actual_start_at: Option<Option<String>>,
    #[serde(default, deserialize_with = "clearable")]
    pub actual_finish_at: Option<Option<String>>,
    #[serde(default, deserialize_with = "clearable")]
    pub actual_effort_minutes: Option<Option<i64>>,
    #[serde(default, deserialize_with = "clearable")]
    pub note: Option<Option<String>>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub effort_minutes: Option<i64>,
    #[serde(default)]
    pub priority: Option<String>,
    #[serde(default)]
    pub exclusive: Option<bool>,
    #[serde(default, deserialize_with = "clearable")]
    pub requirement_id: Option<Option<String>>,
    #[serde(default, deserialize_with = "clearable")]
    pub issue_id: Option<Option<String>>,
}

/// The plan the sheet is showing for a new subtask. Sending it with the add keeps an
/// unsaved parent plan from being lost when the parent turns into an umbrella.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtaskPlanDto {
    pub expected_start_date: Option<String>,
    pub expected_finish_date: Option<String>,
    pub effort_minutes: i64,
}

/// A recurring rule: the weekday set and time a task appears at.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleDto {
    pub id: String,
    pub title: String,
    /// The world the generated tasks belong to; the UI never sends this back.
    #[serde(skip_serializing)]
    pub scope: String,
    /// ISO weekdays, Monday = 1 … Sunday = 7.
    pub weekdays: Vec<u32>,
    /// Local "HH:MM".
    pub at: String,
    pub project_id: Option<String>,
    pub category_id: Option<String>,
    pub owner_id: Option<String>,
    pub priority: String,
    pub effort_minutes: i64,
    pub exclusive: bool,
    pub enabled: bool,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleInput {
    /// Absent creates a rule; present rewrites that rule.
    #[serde(default)]
    pub id: Option<String>,
    pub title: String,
    pub weekdays: Vec<u32>,
    pub at: String,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub category_id: Option<String>,
    #[serde(default)]
    pub owner_id: Option<String>,
    #[serde(default)]
    pub priority: Option<String>,
    #[serde(default)]
    pub effort_minutes: Option<i64>,
    #[serde(default)]
    pub exclusive: Option<bool>,
}

/// A fixed flow: the attributes and the step titles every task starts with.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateDto {
    pub id: String,
    pub name: String,
    /// The world a task made from this template belongs to.
    #[serde(skip_serializing)]
    pub scope: String,
    pub project_id: Option<String>,
    pub category_id: Option<String>,
    pub owner_id: Option<String>,
    pub priority: String,
    pub effort_minutes: i64,
    pub exclusive: bool,
    pub note: Option<String>,
    pub steps: Vec<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateInput {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub category_id: Option<String>,
    #[serde(default)]
    pub owner_id: Option<String>,
    #[serde(default)]
    pub priority: Option<String>,
    #[serde(default)]
    pub effort_minutes: Option<i64>,
    #[serde(default)]
    pub exclusive: Option<bool>,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub steps: Vec<String>,
}

/// The fields a quick capture can carry. All optional: a missing field keeps the
/// database default (owner "me", priority "normal", effort 480 minutes). The expected
/// finish is not here: it always follows the estimate.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureFields {
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub owner_id: Option<String>,
    #[serde(default)]
    pub priority: Option<String>,
    #[serde(default)]
    pub effort_minutes: Option<i64>,
    /// Local day the plan starts; the finish counts workdays from it. None means today.
    #[serde(default)]
    pub expected_start_date: Option<String>,
    /// Local day the actual work began (09:00). Without done it starts the task.
    #[serde(default)]
    pub actual_start_date: Option<String>,
    /// What the work really took; a finished line falls back to the estimate.
    #[serde(default)]
    pub actual_effort_minutes: Option<i64>,
    #[serde(default)]
    pub category_id: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub exclusive: Option<bool>,
    #[serde(default)]
    pub tags: Vec<String>,
}

/// Without this, serde maps an explicit `null` to the same `None` as a missing field.
fn clearable<'de, T, D>(de: D) -> Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    Ok(Some(Option::<T>::deserialize(de)?))
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatch {
    pub language: Option<String>,
    pub ai_enabled: Option<bool>,
    pub ai_base_url: Option<String>,
    pub ai_model: Option<String>,
    pub autostart: Option<bool>,
    pub backup_keep_days: Option<i64>,
    pub theme: Option<String>,
    pub desk_enabled: Option<bool>,
    pub desk_controls: Option<bool>,
    pub desk_pin: Option<String>,
    pub desk_x: Option<i64>,
    pub desk_y: Option<i64>,
    pub tasks_group_by: Option<String>,
    pub week_show_empty_days: Option<bool>,
    pub week_hide_done: Option<bool>,
    pub week_view: Option<String>,
    pub task_default_exclusive: Option<bool>,
    pub overdue_prompt: Option<bool>,
    pub saved_task_views: Option<Vec<SavedTaskViewDto>>,
    pub reminders_lead_minutes: Option<i64>,
    pub reminders_digest: Option<bool>,
    pub updates_auto_check: Option<bool>,
    pub mode_auto: Option<bool>,
    pub mode_work_at: Option<String>,
    pub mode_personal_at: Option<String>,
    pub mode_days: Option<Vec<u32>>,
    pub mode_hint_dismissed: Option<bool>,
}

/// A task-page filter saved under a name. The filter itself is a plain value
/// so it can round-trip through the settings table as JSON.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskFilterDto {
    #[serde(default)]
    pub query: String,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub category_id: Option<String>,
    #[serde(default)]
    pub owner_id: Option<String>,
    #[serde(default)]
    pub tag_id: Option<String>,
    #[serde(default)]
    pub priority: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedTaskViewDto {
    pub id: String,
    pub name: String,
    /// One of the task page groupings.
    pub group_by: String,
    pub filter: TaskFilterDto,
}

/// One global-search result: a task in any state or a live project.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHitDto {
    /// "task" or "project".
    pub kind: String,
    pub id: String,
    pub title: String,
    /// The project name for tasks; empty for projects.
    pub subtitle: Option<String>,
    /// "active", "done", "archived" or "canceled".
    pub state: String,
}

/// The number format a project applies to its requirements and issues.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectNumberingDto {
    pub requirement_prefix: String,
    pub requirement_width: i64,
    pub issue_prefix: String,
    pub issue_width: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequirementStatusDto {
    pub id: String,
    pub name: String,
}

/// One row of the editable pipeline; a null id marks a status being created.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequirementStatusInput {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequirementSectionRefDto {
    pub section_id: String,
    pub section_title: String,
    pub document_id: String,
    pub document_title: String,
    /// The selected text a reader-made requirement was created from.
    pub quote: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedTaskDto {
    pub id: String,
    pub title: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedIssueDto {
    pub id: String,
    pub title: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequirementDto {
    pub id: String,
    pub project_id: String,
    pub number: String,
    pub title: String,
    pub status_id: Option<String>,
    pub category_id: Option<String>,
    pub owner_id: Option<String>,
    pub sections: Vec<RequirementSectionRefDto>,
    pub tasks: Vec<LinkedTaskDto>,
    pub issues: Vec<LinkedIssueDto>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequirementPatch {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default, deserialize_with = "clearable")]
    pub category_id: Option<Option<String>>,
    #[serde(default, deserialize_with = "clearable")]
    pub owner_id: Option<Option<String>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequirementChangeDto {
    pub id: String,
    pub kind: String,
    pub from_value: Option<String>,
    pub to_value: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSectionSummaryDto {
    pub id: String,
    pub title: String,
    pub level: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentOutlineDto {
    pub id: String,
    pub title: String,
    pub source_name: String,
    pub sections: Vec<DocumentSectionSummaryDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequirementRefDto {
    pub id: String,
    pub number: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSectionDto {
    pub id: String,
    pub title: String,
    pub level: i64,
    pub body: String,
    pub requirements: Vec<RequirementRefDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentDto {
    pub id: String,
    pub title: String,
    pub source_name: String,
    pub sections: Vec<DocumentSectionDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueDto {
    pub id: String,
    pub project_id: String,
    pub number: String,
    pub requirement_id: Option<String>,
    pub title: String,
    pub note: Option<String>,
    pub status: String,
    pub created_at: String,
    pub resolved_at: Option<String>,
    pub tasks: Vec<LinkedTaskDto>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssuePatch {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default, deserialize_with = "clearable")]
    pub note: Option<Option<String>>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default, deserialize_with = "clearable")]
    pub requirement_id: Option<Option<String>>,
}
