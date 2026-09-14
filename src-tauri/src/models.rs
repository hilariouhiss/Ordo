//! Domain models (structs/enums) and their serde serialization.
//!
//! Convention: every persisted row carries a UUID primary key, `created_at`
//! and `updated_at` timestamps, and uses soft delete via a `deleted_at` column.
//!
//! Each struct maps 1:1 onto a table in `migrations/V2__schema.sql` and
//! serializes with camelCase field names to match the frontend IPC conventions
//! in `src/common/ipc/`. The `task_tags` join table has no dedicated model;
//! task/tag associations are expressed through repository queries.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Task urgency, persisted in `tasks.priority` (`high`/`medium`/`low`/`none`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Priority {
    High,
    Medium,
    Low,
    None,
}

/// Project lifecycle state, persisted in `projects.status`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProjectStatus {
    Active,
    Archived,
}

/// Period a repeating task recurs over.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RepeatFreq {
    Daily,
    Weekly,
    Monthly,
}

/// Recurrence rule for a task, persisted in `tasks.repeat_rule` as JSON text.
///
/// On completion (via `task:complete` or by entering a done board column) a
/// task carrying a non-paused rule spawns its next instance, anchored to the
/// task's `due_at` and advanced by one period.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepeatRule {
    pub freq: RepeatFreq,
    /// Recur every `interval` periods; always >= 1 (validated on write).
    pub interval: u32,
    /// Paused rules stay attached but completion spawns no next instance;
    /// un-pausing resumes generation. Defaults to `false` so rules stored
    /// before the flag existed still deserialize.
    #[serde(default)]
    pub paused: bool,
}

/// Which reminder of a task fired (`task_reminders.kind`); the serde values
/// match the column's CHECK constraint.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ReminderKind {
    #[serde(rename = "advance_1h")]
    Advance1h,
    #[serde(rename = "advance_10m")]
    Advance10m,
    #[serde(rename = "due")]
    Due,
}

/// A reminder the scheduler has fired, broadcast to the frontend as a
/// `reminder:triggered` event.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reminder {
    pub task_id: Uuid,
    pub task_title: String,
    pub kind: ReminderKind,
    pub due_at: DateTime<Utc>,
}

/// A project row (`projects`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub due_at: Option<DateTime<Utc>>,
    pub status: ProjectStatus,
    pub sort_order: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
}

/// A kanban column row (`board_columns`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardColumn {
    pub id: Uuid,
    pub project_id: Uuid,
    pub name: String,
    pub position: String,
    pub is_done: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
}

/// A task row (`tasks`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: Uuid,
    pub project_id: Option<Uuid>,
    pub title: String,
    pub note: Option<String>,
    pub priority: Priority,
    pub column_id: Option<Uuid>,
    pub due_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub repeat_rule: Option<RepeatRule>,
    /// 1-5, or `None` when the task was never estimated.
    pub complexity: Option<i64>,
    pub sort_order: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
}

/// Deserialization fallback for [`Subtask::priority`] in documents written
/// before subtasks had a priority: the `subtasks.priority` column defaults to
/// `'none'`, so an absent key means the same thing as the column default.
fn legacy_subtask_priority() -> Priority {
    Priority::None
}

/// A subtask row (`subtasks`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Subtask {
    pub id: Uuid,
    pub task_id: Uuid,
    pub title: String,
    /// Free-form description; `None` when unset.
    pub note: Option<String>,
    /// Missing from backups exported before this column existed.
    #[serde(default = "legacy_subtask_priority")]
    pub priority: Priority,
    pub due_at: Option<DateTime<Utc>>,
    /// 1-5, or `None` when never estimated.
    pub complexity: Option<i64>,
    pub done: bool,
    pub sort_order: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
}

/// A tag row (`tags`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: Uuid,
    pub name: String,
    pub color: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
}

/// A comment row (`comments`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    pub id: Uuid,
    pub task_id: Uuid,
    pub body: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
}

/// A time-tracking row (`time_entries`); `duration` is measured in seconds.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeEntry {
    pub id: Uuid,
    pub task_id: Uuid,
    pub started_at: Option<DateTime<Utc>>,
    pub ended_at: Option<DateTime<Utc>>,
    pub duration: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
}

/// A settings row (`settings`); a plain key/value store without soft delete.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Setting {
    pub key: String,
    pub value: String,
    pub updated_at: DateTime<Utc>,
}

// --- backups (`backup:*`) ----------------------------------------------------

/// One task↔tag link (`task_tags`); the join table has no model of its own
/// elsewhere, but a backup has to carry the associations.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskTagLink {
    pub task_id: Uuid,
    pub tag_id: Uuid,
}

/// Every user-data table, exactly as a backup carries them.
///
/// Soft-deleted rows are included on purpose: a backup is a copy of the
/// database, not a view of it. `task_reminders` stays out — those markers only
/// dedup notifications and are rebuilt by the scheduler.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupData {
    #[serde(default)]
    pub projects: Vec<Project>,
    #[serde(default)]
    pub board_columns: Vec<BoardColumn>,
    #[serde(default)]
    pub tags: Vec<Tag>,
    #[serde(default)]
    pub tasks: Vec<Task>,
    #[serde(default)]
    pub subtasks: Vec<Subtask>,
    #[serde(default)]
    pub task_tags: Vec<TaskTagLink>,
    #[serde(default)]
    pub comments: Vec<Comment>,
    #[serde(default)]
    pub time_entries: Vec<TimeEntry>,
    #[serde(default)]
    pub settings: Vec<Setting>,
}

/// Row counts of one backup, so the settings page can say what moved.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupCounts {
    pub projects: usize,
    pub board_columns: usize,
    pub tasks: usize,
    pub subtasks: usize,
    pub tags: usize,
    pub comments: usize,
    pub time_entries: usize,
    pub settings: usize,
}

impl BackupData {
    /// Tallies of this payload, for the export/import confirmation.
    pub fn counts(&self) -> BackupCounts {
        BackupCounts {
            projects: self.projects.len(),
            board_columns: self.board_columns.len(),
            tasks: self.tasks.len(),
            subtasks: self.subtasks.len(),
            tags: self.tags.len(),
            comments: self.comments.len(),
            time_entries: self.time_entries.len(),
            settings: self.settings.len(),
        }
    }
}

/// A backup file: the whole database as one JSON document.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupDocument {
    /// Format marker (`ordo.backup`), so a foreign JSON file is refused
    /// instead of half-imported.
    pub format: String,
    /// Generation of the format; an import refuses anything newer.
    pub version: u32,
    pub exported_at: DateTime<Utc>,
    pub data: BackupData,
}

/// What an export wrote or an import restored.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSummary {
    pub path: String,
    /// Stamp of the document that was written or read.
    pub exported_at: DateTime<Utc>,
    pub counts: BackupCounts,
}

/// A task plus its tag associations — the response shape of `task:list`.
///
/// There is no dedicated command for reading task↔tag links; the task list
/// carries them so the frontend store can filter by tag in one round trip.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskWithTags {
    #[serde(flatten)]
    pub task: Task,
    #[serde(default)]
    pub tag_ids: Vec<Uuid>,
}

/// Which entity produced a search hit (`search:query`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SearchHitKind {
    Task,
    Comment,
}

/// One full-text search hit — the response item of `search:query`.
///
/// Comment hits carry the parent task's id/title so the frontend can always
/// navigate to the owning task; `snippet` highlights the first match window
/// with `<mark>`/`</mark>` markers.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub kind: SearchHitKind,
    /// Id of the matching entity (the task itself, or the comment).
    pub id: Uuid,
    /// Id of the task to navigate to (for task hits, same as `id`).
    pub task_id: Uuid,
    pub task_title: String,
    pub snippet: String,
}

// --- write-command payloads --------------------------------------------------

/// Update-patch semantics for one nullable column.
///
/// Nullable columns in update payloads use this: a missing field leaves the
/// stored value unchanged, an explicit `null` clears the column, and a value
/// replaces it. (`Option<Option<T>>` alone cannot express this — serde
/// collapses a missing field and an explicit `null` to the same `None`.)
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub enum Patch<T> {
    /// Field absent from the payload: leave the stored value unchanged.
    #[default]
    Unchanged,
    /// Field present (possibly `null`): set the column to the given value.
    Set(Option<T>),
}

impl<'de, T: Deserialize<'de>> Deserialize<'de> for Patch<T> {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        Ok(Patch::Set(Option::<T>::deserialize(deserializer)?))
    }
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewTask {
    pub title: String,
    pub note: Option<String>,
    pub priority: Option<Priority>,
    pub project_id: Option<Uuid>,
    pub column_id: Option<Uuid>,
    pub due_at: Option<DateTime<Utc>>,
    /// 1-5 estimate, or `None` for an unestimated task (validated on write).
    pub complexity: Option<i64>,
    #[serde(default)]
    pub tag_ids: Vec<Uuid>,
    #[serde(default)]
    pub subtask_titles: Vec<String>,
    #[serde(default)]
    pub repeat_rule: Option<RepeatRule>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTask {
    pub title: Option<String>,
    #[serde(default)]
    pub note: Patch<String>,
    pub priority: Option<Priority>,
    #[serde(default)]
    pub project_id: Patch<Uuid>,
    #[serde(default)]
    pub column_id: Patch<Uuid>,
    #[serde(default)]
    pub due_at: Patch<DateTime<Utc>>,
    /// Replace/clear (`Patch::Set(None)`) the 1-5 estimate; missing leaves it
    /// unchanged.
    #[serde(default)]
    pub complexity: Patch<i64>,
    #[serde(default)]
    pub completed_at: Patch<DateTime<Utc>>,
    /// Replace the task's tag set; missing leaves the set unchanged.
    pub tag_ids: Option<Vec<Uuid>>,
    /// Replace/clear (`Patch::Set(None)`) the repeat rule; missing leaves it
    /// unchanged.
    #[serde(default)]
    pub repeat_rule: Patch<RepeatRule>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewTag {
    pub name: String,
    pub color: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTag {
    pub name: Option<String>,
    #[serde(default)]
    pub color: Patch<String>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewSubtask {
    pub title: String,
    pub note: Option<String>,
    pub priority: Option<Priority>,
    pub due_at: Option<DateTime<Utc>>,
    pub complexity: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSubtask {
    pub title: Option<String>,
    pub done: Option<bool>,
    #[serde(default)]
    pub note: Patch<String>,
    pub priority: Option<Priority>,
    #[serde(default)]
    pub due_at: Patch<DateTime<Utc>>,
    #[serde(default)]
    pub complexity: Patch<i64>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewProject {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub due_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProject {
    pub name: Option<String>,
    #[serde(default)]
    pub description: Patch<String>,
    #[serde(default)]
    pub color: Patch<String>,
    #[serde(default)]
    pub icon: Patch<String>,
    #[serde(default)]
    pub due_at: Patch<DateTime<Utc>>,
}

/// `board:addColumn` — the new column always appends at the end and starts
/// active (`is_done = false`); the done flag is a later `board:updateColumn`
/// switch.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewBoardColumn {
    pub project_id: Uuid,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateBoardColumn {
    pub name: Option<String>,
    pub is_done: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewComment {
    pub body: String,
}

/// Comments only have a body; edits replace it wholesale.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateComment {
    pub body: String,
}

/// `time:create` — a manually recorded entry: when the work started plus how
/// long it took in seconds. The service derives `ended_at` from the two.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewTimeEntry {
    pub started_at: DateTime<Utc>,
    /// Tracked length in seconds; must be >= 1 (validated on write).
    pub duration: i64,
}

/// `time:update` — edits a manual entry. A missing field keeps its stored
/// value, and `ended_at` is always re-derived from start + duration.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTimeEntry {
    pub started_at: Option<DateTime<Utc>>,
    pub duration: Option<i64>,
}

// --- statistics (`stats:*`) --------------------------------------------------
//
// The statistics layer is read-only: its types are query payloads and result
// rows, never persisted. Ranges are half-open `[from, to)` UTC instants that
// the frontend derives from the user's local boundaries; the UTC `offset`
// lets the backend bucket in that same local calendar.

/// Bucket width of a statistics series.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StatsGranularity {
    Day,
    Week,
    Month,
}

/// `stats:trend` query: completion curve over `[from, to)`.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrendQuery {
    pub from: DateTime<Utc>,
    pub to: DateTime<Utc>,
    pub granularity: StatsGranularity,
    /// Minutes added to stored UTC instants before bucketing, so a day bucket
    /// is the caller's day rather than a UTC one
    /// (`-new Date().getTimezoneOffset()`; 0 means UTC). One offset covers the
    /// whole range — a range spanning a DST switch is off by that hour.
    #[serde(default)]
    pub offset_minutes: i32,
}

/// One point of the completion curve: `bucket` is `YYYY-MM-DD` for day/week
/// (the week's Monday) and `YYYY-MM` for month, in the caller's calendar.
/// Buckets without completions are absent rather than zero-filled.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrendPoint {
    pub bucket: String,
    pub completed: i64,
}

/// One live project's tally (`stats:projectProgress`); completion rate and
/// remaining count derive from `total`/`completed`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectProgress {
    pub project_id: Uuid,
    pub name: String,
    pub total: i64,
    pub completed: i64,
    pub due_at: Option<DateTime<Utc>>,
}

/// Dimension `stats:timeDistribution` splits tracked time by.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TimeGroupBy {
    Project,
    Tag,
}

/// `stats:timeDistribution` query; range and offset follow [`TrendQuery`].
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeDistributionQuery {
    pub group_by: TimeGroupBy,
    pub from: DateTime<Utc>,
    pub to: DateTime<Utc>,
    pub granularity: StatsGranularity,
    #[serde(default)]
    pub offset_minutes: i32,
}

/// Tracked time of one project or tag. `id`/`name` are `None` for the
/// project-less share of a project grouping (inbox time).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeShare {
    pub id: Option<Uuid>,
    pub name: Option<String>,
    pub seconds: i64,
}

/// Tracked time inside one period bucket (see [`TrendPoint::bucket`]).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimePoint {
    pub bucket: String,
    pub seconds: i64,
}

/// `stats:timeDistribution` response: time per group across the range, plus
/// the same time split into period buckets.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeDistribution {
    pub groups: Vec<TimeShare>,
    pub buckets: Vec<TimePoint>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use serde_json::json;

    fn ts() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 9, 8, 12, 0, 0).unwrap()
    }

    /// Sorted object keys of a serialized model, so assertions do not depend
    /// on serde_json's map ordering.
    fn sorted_keys(value: &serde_json::Value) -> Vec<String> {
        let mut keys: Vec<String> = value.as_object().unwrap().keys().cloned().collect();
        keys.sort();
        keys
    }

    #[test]
    fn update_payloads_distinguish_missing_and_null() {
        let missing: UpdateTask = serde_json::from_value(json!({ "title": "新标题" })).unwrap();
        assert_eq!(missing.title.as_deref(), Some("新标题"));
        assert_eq!(missing.note, Patch::Unchanged);
        assert_eq!(missing.tag_ids, None);
        assert_eq!(missing.repeat_rule, Patch::Unchanged);

        let explicit_null: UpdateTask =
            serde_json::from_value(json!({ "note": null, "tagIds": [], "repeatRule": null }))
                .unwrap();
        assert_eq!(explicit_null.note, Patch::Set(None));
        assert_eq!(explicit_null.tag_ids, Some(Vec::new()));
        assert_eq!(explicit_null.repeat_rule, Patch::Set(None));
        assert_eq!(explicit_null.due_at, Patch::Unchanged);

        let new_task: NewTask = serde_json::from_value(json!({ "title": "任务" })).unwrap();
        assert!(new_task.tag_ids.is_empty());
        assert!(new_task.subtask_titles.is_empty());
        assert_eq!(new_task.priority, None);
        assert_eq!(new_task.repeat_rule, None);
    }

    #[test]
    fn task_with_tags_flattens_task_fields() {
        let task = Task {
            id: Uuid::nil(),
            project_id: None,
            title: "写周报".into(),
            note: None,
            priority: Priority::None,
            column_id: None,
            due_at: None,
            completed_at: None,
            repeat_rule: None,
            complexity: None,
            sort_order: "n".into(),
            created_at: ts(),
            updated_at: ts(),
            deleted_at: None,
        };
        let value = serde_json::to_value(TaskWithTags {
            task: task.clone(),
            tag_ids: vec![Uuid::nil()],
        })
        .unwrap();

        // Task fields sit at the top level next to `tagIds`.
        assert_eq!(value["id"], json!(task.id.to_string()));
        assert_eq!(value["title"], json!("写周报"));
        assert_eq!(value["tagIds"], json!([Uuid::nil().to_string()]));
        assert!(value.get("task").is_none(), "inner task is flattened away");
    }

    #[test]
    fn task_fields_serialize_as_camel_case() {
        let task = Task {
            id: Uuid::nil(),
            project_id: None,
            title: "写周报".into(),
            note: None,
            priority: Priority::High,
            column_id: None,
            due_at: None,
            completed_at: None,
            repeat_rule: None,
            complexity: None,
            sort_order: "a".into(),
            created_at: ts(),
            updated_at: ts(),
            deleted_at: None,
        };

        let value = serde_json::to_value(&task).unwrap();
        assert_eq!(
            sorted_keys(&value),
            [
                "columnId",
                "completedAt",
                "complexity",
                "createdAt",
                "deletedAt",
                "dueAt",
                "id",
                "note",
                "priority",
                "projectId",
                "repeatRule",
                "sortOrder",
                "title",
                "updatedAt",
            ]
            .map(String::from)
            .to_vec()
        );
        assert_eq!(value["title"], json!("写周报"));
        assert_eq!(value["priority"], json!("high"));
        // Optional columns keep a stable shape by serializing to null.
        assert_eq!(value["projectId"], json!(null));
        assert_eq!(value["repeatRule"], json!(null));
    }

    #[test]
    fn project_fields_serialize_as_camel_case() {
        let project = Project {
            id: Uuid::nil(),
            name: "Ordo".into(),
            description: None,
            color: None,
            icon: None,
            due_at: None,
            status: ProjectStatus::Active,
            sort_order: "a".into(),
            created_at: ts(),
            updated_at: ts(),
            deleted_at: None,
        };

        let value = serde_json::to_value(&project).unwrap();
        assert_eq!(
            sorted_keys(&value),
            [
                "color",
                "createdAt",
                "deletedAt",
                "description",
                "dueAt",
                "icon",
                "id",
                "name",
                "sortOrder",
                "status",
                "updatedAt",
            ]
            .map(String::from)
            .to_vec()
        );
        assert_eq!(value["status"], json!("active"));
    }

    #[test]
    fn board_column_fields_serialize_as_camel_case() {
        let column = BoardColumn {
            id: Uuid::nil(),
            project_id: Uuid::nil(),
            name: "待办".into(),
            position: "a".into(),
            is_done: false,
            created_at: ts(),
            updated_at: ts(),
            deleted_at: None,
        };

        let value = serde_json::to_value(&column).unwrap();
        assert_eq!(
            sorted_keys(&value),
            [
                "createdAt",
                "deletedAt",
                "id",
                "isDone",
                "name",
                "position",
                "projectId",
                "updatedAt",
            ]
            .map(String::from)
            .to_vec()
        );
        assert_eq!(value["isDone"], json!(false));
    }

    #[test]
    fn subtask_fields_serialize_as_camel_case() {
        let subtask = Subtask {
            id: Uuid::nil(),
            task_id: Uuid::nil(),
            title: "收集数据".into(),
            note: Some("先拉近三个月".into()),
            priority: Priority::High,
            due_at: Some(ts()),
            complexity: Some(2),
            done: false,
            sort_order: "a".into(),
            created_at: ts(),
            updated_at: ts(),
            deleted_at: None,
        };

        let value = serde_json::to_value(&subtask).unwrap();
        assert_eq!(
            sorted_keys(&value),
            [
                "complexity",
                "createdAt",
                "deletedAt",
                "done",
                "dueAt",
                "id",
                "note",
                "priority",
                "sortOrder",
                "taskId",
                "title",
                "updatedAt",
            ]
            .map(String::from)
            .to_vec()
        );
    }

    #[test]
    fn tag_fields_serialize_as_camel_case() {
        let tag = Tag {
            id: Uuid::nil(),
            name: "工作".into(),
            color: None,
            created_at: ts(),
            updated_at: ts(),
            deleted_at: None,
        };

        let value = serde_json::to_value(&tag).unwrap();
        assert_eq!(
            sorted_keys(&value),
            ["color", "createdAt", "deletedAt", "id", "name", "updatedAt"]
                .map(String::from)
                .to_vec()
        );
    }

    #[test]
    fn comment_fields_serialize_as_camel_case() {
        let comment = Comment {
            id: Uuid::nil(),
            task_id: Uuid::nil(),
            body: "备注内容".into(),
            created_at: ts(),
            updated_at: ts(),
            deleted_at: None,
        };

        let value = serde_json::to_value(&comment).unwrap();
        assert_eq!(
            sorted_keys(&value),
            [
                "body",
                "createdAt",
                "deletedAt",
                "id",
                "taskId",
                "updatedAt"
            ]
            .map(String::from)
            .to_vec()
        );
    }

    #[test]
    fn time_entry_fields_serialize_as_camel_case() {
        let entry = TimeEntry {
            id: Uuid::nil(),
            task_id: Uuid::nil(),
            started_at: Some(ts()),
            ended_at: None,
            duration: 1800,
            created_at: ts(),
            updated_at: ts(),
            deleted_at: None,
        };

        let value = serde_json::to_value(&entry).unwrap();
        assert_eq!(
            sorted_keys(&value),
            [
                "createdAt",
                "deletedAt",
                "duration",
                "endedAt",
                "id",
                "startedAt",
                "taskId",
                "updatedAt",
            ]
            .map(String::from)
            .to_vec()
        );
        assert_eq!(value["duration"], json!(1800));
    }

    #[test]
    fn setting_fields_serialize_as_camel_case() {
        let setting = Setting {
            key: "theme".into(),
            value: "dark".into(),
            updated_at: ts(),
        };

        let value = serde_json::to_value(&setting).unwrap();
        assert_eq!(
            sorted_keys(&value),
            ["key", "updatedAt", "value"].map(String::from).to_vec()
        );
    }

    #[test]
    fn enums_match_schema_check_values() {
        assert_eq!(serde_json::to_value(Priority::High).unwrap(), json!("high"));
        assert_eq!(
            serde_json::to_value(Priority::Medium).unwrap(),
            json!("medium")
        );
        assert_eq!(serde_json::to_value(Priority::Low).unwrap(), json!("low"));
        assert_eq!(serde_json::to_value(Priority::None).unwrap(), json!("none"));
        assert_eq!(
            serde_json::to_value(ProjectStatus::Active).unwrap(),
            json!("active")
        );
        assert_eq!(
            serde_json::to_value(ProjectStatus::Archived).unwrap(),
            json!("archived")
        );

        assert!(serde_json::from_value::<Priority>(json!("urgent")).is_err());
        assert!(serde_json::from_value::<ProjectStatus>(json!("deleted")).is_err());
    }

    #[test]
    fn search_hit_fields_serialize_as_camel_case() {
        let hit = SearchHit {
            kind: SearchHitKind::Comment,
            id: Uuid::nil(),
            task_id: Uuid::nil(),
            task_title: "写周报".into(),
            snippet: "评语<mark>周报</mark>内容".into(),
        };

        let value = serde_json::to_value(&hit).unwrap();
        assert_eq!(
            sorted_keys(&value),
            ["id", "kind", "snippet", "taskId", "taskTitle"]
                .map(String::from)
                .to_vec()
        );
        assert_eq!(value["kind"], json!("comment"));
        assert_eq!(serde_json::from_value::<SearchHit>(value).unwrap(), hit);
    }

    #[test]
    fn reminder_payloads_serialize_as_camel_case() {
        let value = serde_json::to_value(Reminder {
            task_id: Uuid::nil(),
            task_title: "周报".into(),
            kind: ReminderKind::Advance10m,
            due_at: ts(),
        })
        .unwrap();
        assert_eq!(
            sorted_keys(&value),
            ["dueAt", "kind", "taskId", "taskTitle"]
                .map(String::from)
                .to_vec()
        );
        assert_eq!(value["kind"], json!("advance_10m"));
        assert_eq!(
            serde_json::from_value::<Reminder>(value).unwrap().kind,
            ReminderKind::Advance10m
        );
    }

    #[test]
    fn repeat_rule_round_trips() {
        let rule = RepeatRule {
            freq: RepeatFreq::Weekly,
            interval: 2,
            paused: false,
        };
        let value = serde_json::to_value(rule).unwrap();
        assert_eq!(
            value,
            json!({ "freq": "weekly", "interval": 2, "paused": false })
        );
        assert_eq!(serde_json::from_value::<RepeatRule>(value).unwrap(), rule);

        // Rules stored before the paused flag existed deserialize paused=false.
        let legacy: RepeatRule =
            serde_json::from_value(json!({ "freq": "daily", "interval": 1 })).unwrap();
        assert!(!legacy.paused);
    }

    #[test]
    fn timestamps_round_trip_as_iso8601_utc() {
        let value = serde_json::to_value(ts()).unwrap();
        let s = value.as_str().unwrap();
        assert!(
            s.starts_with("2026-09-08T12:00:00"),
            "unexpected format: {s}"
        );
        assert!(s.ends_with('Z') || s.ends_with("+00:00"));
        assert_eq!(
            serde_json::from_value::<DateTime<Utc>>(value).unwrap(),
            ts()
        );
    }
}
