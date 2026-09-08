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
/// Semantics (next-instance generation on completion, pause/end) are defined
/// by RP-01; for now only the serde shape is fixed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepeatRule {
    pub freq: RepeatFreq,
    /// Recur every `interval` periods; always >= 1.
    pub interval: u32,
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
    pub sort_order: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
}

/// A subtask row (`subtasks`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Subtask {
    pub id: Uuid,
    pub task_id: Uuid,
    pub title: String,
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
                "createdAt",
                "deletedAt",
                "done",
                "id",
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
    fn repeat_rule_round_trips() {
        let rule = RepeatRule {
            freq: RepeatFreq::Weekly,
            interval: 2,
        };
        let value = serde_json::to_value(&rule).unwrap();
        assert_eq!(value, json!({ "freq": "weekly", "interval": 2 }));
        assert_eq!(serde_json::from_value::<RepeatRule>(value).unwrap(), rule);
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
