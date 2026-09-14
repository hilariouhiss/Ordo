//! Data access layer: SQL queries against `rusqlite::Connection`.
//!
//! Repositories are the only layer that touches SQL directly. They are pure
//! functions over a `&Connection` (the services layer owns transactions), map
//! rows to `models`, and return `Result<_, AppError>`.
//!
//! Soft delete is the default query semantic: `list`/`get` helpers filter
//! `deleted_at IS NULL` and updates skip soft-deleted rows. Write helpers
//! return whether a row was affected so services can map a miss to
//! `AppError::NotFound`.

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, Row, ToSql};
use uuid::Uuid;

use crate::error::AppError;
use crate::models::{
    BoardColumn, Comment, Priority, Project, ProjectStatus, ReminderKind, RepeatRule, Setting,
    Subtask, Tag, Task, TimeEntry,
};

const TASK_COLUMNS: &str = "id, project_id, title, note, priority, column_id, due_at, \
                            completed_at, repeat_rule, sort_order, created_at, updated_at, \
                            deleted_at";
const TAG_COLUMNS: &str = "id, name, color, created_at, updated_at, deleted_at";
const SUBTASK_COLUMNS: &str = "id, task_id, title, done, sort_order, created_at, updated_at, \
                               deleted_at";
const PROJECT_COLUMNS: &str = "id, name, description, color, icon, due_at, status, sort_order, \
                               created_at, updated_at, deleted_at";
const BOARD_COLUMN_COLUMNS: &str = "id, project_id, name, position, is_done, created_at, \
                                    updated_at, deleted_at";
const COMMENT_COLUMNS: &str = "id, task_id, body, created_at, updated_at, deleted_at";
const SETTING_COLUMNS: &str = "key, value, updated_at";
const TIME_ENTRY_COLUMNS: &str =
    "id, task_id, started_at, ended_at, duration, created_at, updated_at, deleted_at";

type RowMap<T> = fn(&Row<'_>) -> Result<T, AppError>;

/// Runs `sql` and collects every mapped row.
fn query_all<T>(
    conn: &Connection,
    sql: &str,
    params: &[&dyn ToSql],
    map: RowMap<T>,
) -> Result<Vec<T>, AppError> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt
        .query_and_then(params, map)?
        .collect::<Result<Vec<T>, AppError>>()?;
    Ok(rows)
}

/// Runs `sql` and maps the first row, if any.
fn query_one<T>(
    conn: &Connection,
    sql: &str,
    params: &[&dyn ToSql],
    map: RowMap<T>,
) -> Result<Option<T>, AppError> {
    let mut stmt = conn.prepare(sql)?;
    let row = stmt.query_and_then(params, map)?.next().transpose()?;
    Ok(row)
}

fn parse_uuid(text: String) -> Result<Uuid, AppError> {
    Uuid::parse_str(&text).map_err(|e| AppError::Db(format!("invalid UUID {text:?}: {e}")))
}

fn priority_as_text(priority: Priority) -> &'static str {
    match priority {
        Priority::High => "high",
        Priority::Medium => "medium",
        Priority::Low => "low",
        Priority::None => "none",
    }
}

fn priority_from_text(text: &str) -> Result<Priority, AppError> {
    match text {
        "high" => Ok(Priority::High),
        "medium" => Ok(Priority::Medium),
        "low" => Ok(Priority::Low),
        "none" => Ok(Priority::None),
        other => Err(AppError::Db(format!("invalid priority {other:?}"))),
    }
}

fn project_status_as_text(status: ProjectStatus) -> &'static str {
    match status {
        ProjectStatus::Active => "active",
        ProjectStatus::Archived => "archived",
    }
}

fn project_status_from_text(text: &str) -> Result<ProjectStatus, AppError> {
    match text {
        "active" => Ok(ProjectStatus::Active),
        "archived" => Ok(ProjectStatus::Archived),
        other => Err(AppError::Db(format!("invalid project status {other:?}"))),
    }
}

fn repeat_rule_as_json(rule: Option<&RepeatRule>) -> Result<Option<String>, AppError> {
    rule.map(|r| serde_json::to_string(r).map_err(|e| AppError::Db(e.to_string())))
        .transpose()
}

fn repeat_rule_from_json(text: Option<String>) -> Result<Option<RepeatRule>, AppError> {
    text.map(|t| {
        serde_json::from_str(&t)
            .map_err(|e| AppError::Db(format!("invalid repeat_rule {t:?}: {e}")))
    })
    .transpose()
}

fn task_from_row(row: &Row<'_>) -> Result<Task, AppError> {
    let priority_text: String = row.get("priority")?;
    Ok(Task {
        id: parse_uuid(row.get("id")?)?,
        project_id: row
            .get::<_, Option<String>>("project_id")?
            .map(parse_uuid)
            .transpose()?,
        title: row.get("title")?,
        note: row.get("note")?,
        priority: priority_from_text(&priority_text)?,
        column_id: row
            .get::<_, Option<String>>("column_id")?
            .map(parse_uuid)
            .transpose()?,
        due_at: row.get("due_at")?,
        completed_at: row.get("completed_at")?,
        repeat_rule: repeat_rule_from_json(row.get("repeat_rule")?)?,
        sort_order: row.get("sort_order")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        deleted_at: row.get("deleted_at")?,
    })
}

fn tag_from_row(row: &Row<'_>) -> Result<Tag, AppError> {
    Ok(Tag {
        id: parse_uuid(row.get("id")?)?,
        name: row.get("name")?,
        color: row.get("color")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        deleted_at: row.get("deleted_at")?,
    })
}

fn subtask_from_row(row: &Row<'_>) -> Result<Subtask, AppError> {
    Ok(Subtask {
        id: parse_uuid(row.get("id")?)?,
        task_id: parse_uuid(row.get("task_id")?)?,
        title: row.get("title")?,
        done: row.get("done")?,
        sort_order: row.get("sort_order")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        deleted_at: row.get("deleted_at")?,
    })
}

fn project_from_row(row: &Row<'_>) -> Result<Project, AppError> {
    let status_text: String = row.get("status")?;
    Ok(Project {
        id: parse_uuid(row.get("id")?)?,
        name: row.get("name")?,
        description: row.get("description")?,
        color: row.get("color")?,
        icon: row.get("icon")?,
        due_at: row.get("due_at")?,
        status: project_status_from_text(&status_text)?,
        sort_order: row.get("sort_order")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        deleted_at: row.get("deleted_at")?,
    })
}

fn board_column_from_row(row: &Row<'_>) -> Result<BoardColumn, AppError> {
    Ok(BoardColumn {
        id: parse_uuid(row.get("id")?)?,
        project_id: parse_uuid(row.get("project_id")?)?,
        name: row.get("name")?,
        position: row.get("position")?,
        is_done: row.get("is_done")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        deleted_at: row.get("deleted_at")?,
    })
}

fn comment_from_row(row: &Row<'_>) -> Result<Comment, AppError> {
    Ok(Comment {
        id: parse_uuid(row.get("id")?)?,
        task_id: parse_uuid(row.get("task_id")?)?,
        body: row.get("body")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        deleted_at: row.get("deleted_at")?,
    })
}

fn setting_from_row(row: &Row<'_>) -> Result<Setting, AppError> {
    Ok(Setting {
        key: row.get("key")?,
        value: row.get("value")?,
        updated_at: row.get("updated_at")?,
    })
}

fn time_entry_from_row(row: &Row<'_>) -> Result<TimeEntry, AppError> {
    Ok(TimeEntry {
        id: parse_uuid(row.get("id")?)?,
        task_id: parse_uuid(row.get("task_id")?)?,
        started_at: row.get("started_at")?,
        ended_at: row.get("ended_at")?,
        duration: row.get("duration")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        deleted_at: row.get("deleted_at")?,
    })
}

/// Task CRUD (`tasks` table).
pub mod tasks {
    use super::*;

    pub fn insert(conn: &Connection, task: &Task) -> Result<(), AppError> {
        conn.execute(
            "INSERT INTO tasks (id, project_id, title, note, priority, column_id, due_at, \
             completed_at, repeat_rule, sort_order, created_at, updated_at, deleted_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                task.id.to_string(),
                task.project_id.map(|id| id.to_string()),
                task.title,
                task.note,
                priority_as_text(task.priority),
                task.column_id.map(|id| id.to_string()),
                task.due_at,
                task.completed_at,
                repeat_rule_as_json(task.repeat_rule.as_ref())?,
                task.sort_order,
                task.created_at,
                task.updated_at,
                task.deleted_at,
            ],
        )?;
        Ok(())
    }

    pub fn get(conn: &Connection, id: Uuid) -> Result<Option<Task>, AppError> {
        query_one(
            conn,
            &format!("SELECT {TASK_COLUMNS} FROM tasks WHERE id = ?1 AND deleted_at IS NULL"),
            params![id.to_string()],
            task_from_row,
        )
    }

    /// All non-deleted tasks ordered by `sort_order`; views (inbox/today/...)
    /// are derived by the frontend, which groups and re-sorts per list.
    pub fn list(conn: &Connection) -> Result<Vec<Task>, AppError> {
        query_all(
            conn,
            &format!(
                "SELECT {TASK_COLUMNS} FROM tasks WHERE deleted_at IS NULL \
                 ORDER BY sort_order, created_at, id"
            ),
            &[],
            task_from_row,
        )
    }

    /// Full-row update; returns false when the task is missing or soft-deleted.
    pub fn update(conn: &Connection, task: &Task) -> Result<bool, AppError> {
        let affected = conn.execute(
            "UPDATE tasks SET project_id = ?1, title = ?2, note = ?3, priority = ?4, \
             column_id = ?5, due_at = ?6, completed_at = ?7, repeat_rule = ?8, \
             sort_order = ?9, updated_at = ?10 \
             WHERE id = ?11 AND deleted_at IS NULL",
            params![
                task.project_id.map(|id| id.to_string()),
                task.title,
                task.note,
                priority_as_text(task.priority),
                task.column_id.map(|id| id.to_string()),
                task.due_at,
                task.completed_at,
                repeat_rule_as_json(task.repeat_rule.as_ref())?,
                task.sort_order,
                task.updated_at,
                task.id.to_string(),
            ],
        )?;
        Ok(affected == 1)
    }

    pub fn soft_delete(conn: &Connection, id: Uuid, at: DateTime<Utc>) -> Result<bool, AppError> {
        let affected = conn.execute(
            "UPDATE tasks SET deleted_at = ?1, updated_at = ?1 \
             WHERE id = ?2 AND deleted_at IS NULL",
            params![at, id.to_string()],
        )?;
        Ok(affected == 1)
    }

    pub fn restore(conn: &Connection, id: Uuid, at: DateTime<Utc>) -> Result<bool, AppError> {
        let affected = conn.execute(
            "UPDATE tasks SET deleted_at = NULL, updated_at = ?1 \
             WHERE id = ?2 AND deleted_at IS NOT NULL",
            params![at, id.to_string()],
        )?;
        Ok(affected == 1)
    }

    /// Targeted `sort_order` write used by service-level rebalances.
    pub fn set_sort_order(
        conn: &Connection,
        id: Uuid,
        sort_order: &str,
        at: DateTime<Utc>,
    ) -> Result<bool, AppError> {
        let affected = conn.execute(
            "UPDATE tasks SET sort_order = ?1, updated_at = ?2 \
             WHERE id = ?3 AND deleted_at IS NULL",
            params![sort_order, at, id.to_string()],
        )?;
        Ok(affected == 1)
    }

    /// Clears `column_id` on every task still pointing at the column (used
    /// when a board column is deleted; soft delete doesn't fire the FK's ON
    /// DELETE SET NULL). Covers soft-deleted tasks too, so a restored task
    /// never re-enters a column that no longer exists.
    pub fn clear_column(
        conn: &Connection,
        column_id: Uuid,
        at: DateTime<Utc>,
    ) -> Result<usize, AppError> {
        let affected = conn.execute(
            "UPDATE tasks SET column_id = NULL, updated_at = ?1 WHERE column_id = ?2",
            params![at, column_id.to_string()],
        )?;
        Ok(affected)
    }
}

/// Tag CRUD (`tags` table). `name` is `UNIQUE COLLATE NOCASE`.
pub mod tags {
    use super::*;

    pub fn insert(conn: &Connection, tag: &Tag) -> Result<(), AppError> {
        conn.execute(
            "INSERT INTO tags (id, name, color, created_at, updated_at, deleted_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                tag.id.to_string(),
                tag.name,
                tag.color,
                tag.created_at,
                tag.updated_at,
                tag.deleted_at,
            ],
        )?;
        Ok(())
    }

    pub fn get(conn: &Connection, id: Uuid) -> Result<Option<Tag>, AppError> {
        query_one(
            conn,
            &format!("SELECT {TAG_COLUMNS} FROM tags WHERE id = ?1 AND deleted_at IS NULL"),
            params![id.to_string()],
            tag_from_row,
        )
    }

    /// Case-insensitive lookup by name (the column collation is NOCASE).
    pub fn find_by_name(conn: &Connection, name: &str) -> Result<Option<Tag>, AppError> {
        query_one(
            conn,
            &format!("SELECT {TAG_COLUMNS} FROM tags WHERE name = ?1 AND deleted_at IS NULL"),
            params![name],
            tag_from_row,
        )
    }

    /// All non-deleted tags, case-insensitively ordered by name.
    pub fn list(conn: &Connection) -> Result<Vec<Tag>, AppError> {
        query_all(
            conn,
            &format!(
                "SELECT {TAG_COLUMNS} FROM tags WHERE deleted_at IS NULL \
                 ORDER BY name COLLATE NOCASE, id"
            ),
            &[],
            tag_from_row,
        )
    }

    /// Full-row update; returns false when the tag is missing or soft-deleted.
    pub fn update(conn: &Connection, tag: &Tag) -> Result<bool, AppError> {
        let affected = conn.execute(
            "UPDATE tags SET name = ?1, color = ?2, updated_at = ?3 \
             WHERE id = ?4 AND deleted_at IS NULL",
            params![tag.name, tag.color, tag.updated_at, tag.id.to_string(),],
        )?;
        Ok(affected == 1)
    }

    pub fn soft_delete(conn: &Connection, id: Uuid, at: DateTime<Utc>) -> Result<bool, AppError> {
        let affected = conn.execute(
            "UPDATE tags SET deleted_at = ?1, updated_at = ?1 \
             WHERE id = ?2 AND deleted_at IS NULL",
            params![at, id.to_string()],
        )?;
        Ok(affected == 1)
    }
}

/// Subtask CRUD (`subtasks` table), always scoped to a parent task.
pub mod subtasks {
    use super::*;

    pub fn insert(conn: &Connection, subtask: &Subtask) -> Result<(), AppError> {
        conn.execute(
            "INSERT INTO subtasks (id, task_id, title, done, sort_order, created_at, \
             updated_at, deleted_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                subtask.id.to_string(),
                subtask.task_id.to_string(),
                subtask.title,
                subtask.done,
                subtask.sort_order,
                subtask.created_at,
                subtask.updated_at,
                subtask.deleted_at,
            ],
        )?;
        Ok(())
    }

    pub fn get(conn: &Connection, id: Uuid) -> Result<Option<Subtask>, AppError> {
        query_one(
            conn,
            &format!("SELECT {SUBTASK_COLUMNS} FROM subtasks WHERE id = ?1 AND deleted_at IS NULL"),
            params![id.to_string()],
            subtask_from_row,
        )
    }

    /// Non-deleted subtasks of one task, ordered by `sort_order`.
    pub fn list_by_task(conn: &Connection, task_id: Uuid) -> Result<Vec<Subtask>, AppError> {
        query_all(
            conn,
            &format!(
                "SELECT {SUBTASK_COLUMNS} FROM subtasks \
                 WHERE task_id = ?1 AND deleted_at IS NULL ORDER BY sort_order, created_at, id"
            ),
            params![task_id.to_string()],
            subtask_from_row,
        )
    }

    /// Every live subtask of every live task, for the eager load behind the
    /// hierarchical task list.
    ///
    /// `IN (SELECT ...)` rather than `JOIN tasks`: `SUBTASK_COLUMNS` has no
    /// table prefix, so a join would make its `id` and `deleted_at` ambiguous
    /// against `tasks` and force a second, prefixed copy of the column list.
    /// `tasks.id` is the primary key, so the subquery is an index lookup.
    ///
    /// The parent check is load-bearing: `soft_delete_task` does not cascade,
    /// so without it a deleted task's subtasks would ride along in every load
    /// forever, growing without bound as tasks are deleted.
    pub fn list_all(conn: &Connection) -> Result<Vec<Subtask>, AppError> {
        query_all(
            conn,
            &format!(
                "SELECT {SUBTASK_COLUMNS} FROM subtasks \
                 WHERE deleted_at IS NULL \
                   AND task_id IN (SELECT id FROM tasks WHERE deleted_at IS NULL) \
                 ORDER BY task_id, sort_order, created_at, id"
            ),
            &[],
            subtask_from_row,
        )
    }

    /// Full-row update; returns false when the subtask is missing or
    /// soft-deleted.
    pub fn update(conn: &Connection, subtask: &Subtask) -> Result<bool, AppError> {
        let affected = conn.execute(
            "UPDATE subtasks SET title = ?1, done = ?2, sort_order = ?3, updated_at = ?4 \
             WHERE id = ?5 AND deleted_at IS NULL",
            params![
                subtask.title,
                subtask.done,
                subtask.sort_order,
                subtask.updated_at,
                subtask.id.to_string(),
            ],
        )?;
        Ok(affected == 1)
    }

    pub fn soft_delete(conn: &Connection, id: Uuid, at: DateTime<Utc>) -> Result<bool, AppError> {
        let affected = conn.execute(
            "UPDATE subtasks SET deleted_at = ?1, updated_at = ?1 \
             WHERE id = ?2 AND deleted_at IS NULL",
            params![at, id.to_string()],
        )?;
        Ok(affected == 1)
    }

    /// Targeted `sort_order` write used by service-level rebalances.
    pub fn set_sort_order(
        conn: &Connection,
        id: Uuid,
        sort_order: &str,
        at: DateTime<Utc>,
    ) -> Result<bool, AppError> {
        let affected = conn.execute(
            "UPDATE subtasks SET sort_order = ?1, updated_at = ?2 \
             WHERE id = ?3 AND deleted_at IS NULL",
            params![sort_order, at, id.to_string()],
        )?;
        Ok(affected == 1)
    }
}

/// Task ↔ tag associations (`task_tags` join table).
pub mod task_tags {
    use super::*;

    /// Replaces the task's tag set; `tag_ids` must be unique (the join table
    /// primary key rejects duplicates) and reference existing tags (FK).
    pub fn set_task_tags(
        conn: &Connection,
        task_id: Uuid,
        tag_ids: &[Uuid],
    ) -> Result<(), AppError> {
        conn.execute(
            "DELETE FROM task_tags WHERE task_id = ?1",
            params![task_id.to_string()],
        )?;
        let mut stmt = conn.prepare("INSERT INTO task_tags (task_id, tag_id) VALUES (?1, ?2)")?;
        for tag_id in tag_ids {
            stmt.execute(params![task_id.to_string(), tag_id.to_string()])?;
        }
        Ok(())
    }

    /// Tags attached to a task, ordered by name; soft-deleted tags disappear.
    pub fn list_tags_for_task(conn: &Connection, task_id: Uuid) -> Result<Vec<Tag>, AppError> {
        query_all(
            conn,
            &format!(
                "SELECT {TAG_COLUMNS} FROM tags t JOIN task_tags tt ON tt.tag_id = t.id \
                 WHERE tt.task_id = ?1 AND t.deleted_at IS NULL \
                 ORDER BY t.name COLLATE NOCASE, t.id"
            ),
            params![task_id.to_string()],
            tag_from_row,
        )
    }

    /// Every (task_id, tag_id) link involving live tags; the read path behind
    /// `task:list`'s embedded `tagIds`.
    pub fn list_all(conn: &Connection) -> Result<Vec<(Uuid, Uuid)>, AppError> {
        let mut stmt = conn.prepare(
            "SELECT tt.task_id, tt.tag_id FROM task_tags tt \
             JOIN tags t ON t.id = tt.tag_id \
             WHERE t.deleted_at IS NULL \
             ORDER BY tt.task_id, t.name COLLATE NOCASE",
        )?;
        let links = stmt
            .query_and_then([], |row| {
                Ok((
                    parse_uuid(row.get("task_id")?)?,
                    parse_uuid(row.get("tag_id")?)?,
                ))
            })?
            .collect::<Result<Vec<(Uuid, Uuid)>, AppError>>()?;
        Ok(links)
    }
}

/// Project CRUD (`projects` table).
///
/// Archiving is a `status` flip, not a soft delete: `deleted_at` stays
/// reserved for real deletion (unused by the v1 command surface), while
/// `project:archive`/`project:restore` map onto [`projects::set_status`].
pub mod projects {
    use super::*;

    pub fn insert(conn: &Connection, project: &Project) -> Result<(), AppError> {
        conn.execute(
            "INSERT INTO projects (id, name, description, color, icon, due_at, status, \
             sort_order, created_at, updated_at, deleted_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                project.id.to_string(),
                project.name,
                project.description,
                project.color,
                project.icon,
                project.due_at,
                project_status_as_text(project.status),
                project.sort_order,
                project.created_at,
                project.updated_at,
                project.deleted_at,
            ],
        )?;
        Ok(())
    }

    pub fn get(conn: &Connection, id: Uuid) -> Result<Option<Project>, AppError> {
        query_one(
            conn,
            &format!("SELECT {PROJECT_COLUMNS} FROM projects WHERE id = ?1 AND deleted_at IS NULL"),
            params![id.to_string()],
            project_from_row,
        )
    }

    /// All non-deleted projects (archived ones included; navigation filters by
    /// `status`), ordered like the task list.
    pub fn list(conn: &Connection) -> Result<Vec<Project>, AppError> {
        query_all(
            conn,
            &format!(
                "SELECT {PROJECT_COLUMNS} FROM projects WHERE deleted_at IS NULL \
                 ORDER BY sort_order, created_at, id"
            ),
            &[],
            project_from_row,
        )
    }

    /// Full-row update; returns false when the project is missing or deleted.
    pub fn update(conn: &Connection, project: &Project) -> Result<bool, AppError> {
        let affected = conn.execute(
            "UPDATE projects SET name = ?1, description = ?2, color = ?3, icon = ?4, \
             due_at = ?5, status = ?6, sort_order = ?7, updated_at = ?8 \
             WHERE id = ?9 AND deleted_at IS NULL",
            params![
                project.name,
                project.description,
                project.color,
                project.icon,
                project.due_at,
                project_status_as_text(project.status),
                project.sort_order,
                project.updated_at,
                project.id.to_string(),
            ],
        )?;
        Ok(affected == 1)
    }

    /// Archive/restore flip (`status`); returns false on missing/deleted
    /// projects or when already in the requested state.
    pub fn set_status(
        conn: &Connection,
        id: Uuid,
        status: ProjectStatus,
        at: DateTime<Utc>,
    ) -> Result<bool, AppError> {
        let affected = conn.execute(
            "UPDATE projects SET status = ?1, updated_at = ?2 \
             WHERE id = ?3 AND deleted_at IS NULL AND status != ?1",
            params![project_status_as_text(status), at, id.to_string()],
        )?;
        Ok(affected == 1)
    }

    /// Targeted `sort_order` write used by service-level rebalances.
    pub fn set_sort_order(
        conn: &Connection,
        id: Uuid,
        sort_order: &str,
        at: DateTime<Utc>,
    ) -> Result<bool, AppError> {
        let affected = conn.execute(
            "UPDATE projects SET sort_order = ?1, updated_at = ?2 \
             WHERE id = ?3 AND deleted_at IS NULL",
            params![sort_order, at, id.to_string()],
        )?;
        Ok(affected == 1)
    }
}

/// Board column CRUD (`board_columns` table), always scoped to a project.
pub mod board_columns {
    use super::*;

    pub fn insert(conn: &Connection, column: &BoardColumn) -> Result<(), AppError> {
        conn.execute(
            "INSERT INTO board_columns (id, project_id, name, position, is_done, created_at, \
             updated_at, deleted_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                column.id.to_string(),
                column.project_id.to_string(),
                column.name,
                column.position,
                column.is_done,
                column.created_at,
                column.updated_at,
                column.deleted_at,
            ],
        )?;
        Ok(())
    }

    pub fn get(conn: &Connection, id: Uuid) -> Result<Option<BoardColumn>, AppError> {
        query_one(
            conn,
            &format!(
                "SELECT {BOARD_COLUMN_COLUMNS} FROM board_columns \
                 WHERE id = ?1 AND deleted_at IS NULL"
            ),
            params![id.to_string()],
            board_column_from_row,
        )
    }

    /// Non-deleted columns of one project, ordered by `position`.
    pub fn list_by_project(
        conn: &Connection,
        project_id: Uuid,
    ) -> Result<Vec<BoardColumn>, AppError> {
        query_all(
            conn,
            &format!(
                "SELECT {BOARD_COLUMN_COLUMNS} FROM board_columns \
                 WHERE project_id = ?1 AND deleted_at IS NULL \
                 ORDER BY position, created_at, id"
            ),
            params![project_id.to_string()],
            board_column_from_row,
        )
    }

    /// Full-row update; returns false when the column is missing or deleted.
    pub fn update(conn: &Connection, column: &BoardColumn) -> Result<bool, AppError> {
        let affected = conn.execute(
            "UPDATE board_columns SET name = ?1, position = ?2, is_done = ?3, updated_at = ?4 \
             WHERE id = ?5 AND deleted_at IS NULL",
            params![
                column.name,
                column.position,
                column.is_done,
                column.updated_at,
                column.id.to_string(),
            ],
        )?;
        Ok(affected == 1)
    }

    /// Targeted `position` write used by service-level rebalances.
    pub fn set_position(
        conn: &Connection,
        id: Uuid,
        position: &str,
        at: DateTime<Utc>,
    ) -> Result<bool, AppError> {
        let affected = conn.execute(
            "UPDATE board_columns SET position = ?1, updated_at = ?2 \
             WHERE id = ?3 AND deleted_at IS NULL",
            params![position, at, id.to_string()],
        )?;
        Ok(affected == 1)
    }

    pub fn soft_delete(conn: &Connection, id: Uuid, at: DateTime<Utc>) -> Result<bool, AppError> {
        let affected = conn.execute(
            "UPDATE board_columns SET deleted_at = ?1, updated_at = ?1 \
             WHERE id = ?2 AND deleted_at IS NULL",
            params![at, id.to_string()],
        )?;
        Ok(affected == 1)
    }
}

/// Full-text search over the FTS5 external-content tables `task_search` and
/// `comment_search`, plus a LIKE fallback for terms the trigram tokenizer
/// cannot index (fewer than three characters). Soft-deleted rows stay in the
/// FTS index, so every query joins the source table and filters
/// `deleted_at IS NULL`. FTS paths rank with bm25; the LIKE paths have no
/// relevance signal and order by recency.
pub mod search {
    use super::*;

    /// A task hit from the FTS path; `snippet` carries `<mark>` highlight
    /// markers produced by SQLite's `snippet()`.
    pub struct FtsTaskHit {
        pub id: Uuid,
        pub title: String,
        pub snippet: String,
    }

    /// A comment hit from the FTS path, resolved to its parent task.
    pub struct FtsCommentHit {
        pub id: Uuid,
        pub task_id: Uuid,
        pub task_title: String,
        pub snippet: String,
    }

    /// A matching task's raw text for the LIKE path; the service builds the
    /// snippet (SQL has no snippet function for LIKE scans).
    pub struct LikeTaskRow {
        pub id: Uuid,
        pub title: String,
        pub note: Option<String>,
    }

    /// A matching comment's raw text plus its parent task, for the LIKE path.
    pub struct LikeCommentRow {
        pub id: Uuid,
        pub task_id: Uuid,
        pub task_title: String,
        pub body: String,
    }

    /// Escapes LIKE wildcards and wraps the term in a contains-pattern
    /// (`ESCAPE '\'` must accompany the query).
    fn like_pattern(term: &str) -> String {
        let escaped = term
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_");
        format!("%{escaped}%")
    }

    pub fn fts_tasks(
        conn: &Connection,
        match_expr: &str,
        limit: i64,
    ) -> Result<Vec<FtsTaskHit>, AppError> {
        query_all(
            conn,
            "SELECT t.id, t.title, \
             snippet(task_search, -1, '<mark>', '</mark>', '…', 16) AS snippet \
             FROM task_search \
             JOIN tasks t ON t.rowid = task_search.rowid \
             WHERE task_search MATCH ?1 AND t.deleted_at IS NULL \
             ORDER BY bm25(task_search), t.updated_at DESC, t.id \
             LIMIT ?2",
            params![match_expr, limit],
            |row| {
                Ok(FtsTaskHit {
                    id: parse_uuid(row.get("id")?)?,
                    title: row.get("title")?,
                    snippet: row.get("snippet")?,
                })
            },
        )
    }

    pub fn fts_comments(
        conn: &Connection,
        match_expr: &str,
        limit: i64,
    ) -> Result<Vec<FtsCommentHit>, AppError> {
        query_all(
            conn,
            "SELECT c.id, t.id AS task_id, t.title AS task_title, \
             snippet(comment_search, -1, '<mark>', '</mark>', '…', 16) AS snippet \
             FROM comment_search \
             JOIN comments c ON c.rowid = comment_search.rowid \
             JOIN tasks t ON t.id = c.task_id \
             WHERE comment_search MATCH ?1 AND c.deleted_at IS NULL \
               AND t.deleted_at IS NULL \
             ORDER BY bm25(comment_search), c.updated_at DESC, c.id \
             LIMIT ?2",
            params![match_expr, limit],
            |row| {
                Ok(FtsCommentHit {
                    id: parse_uuid(row.get("id")?)?,
                    task_id: parse_uuid(row.get("task_id")?)?,
                    task_title: row.get("task_title")?,
                    snippet: row.get("snippet")?,
                })
            },
        )
    }

    /// Tasks where every term occurs in title or note; terms are AND-ed
    /// across columns (`title LIKE p1 OR note LIKE p1) AND ...`).
    pub fn like_tasks(
        conn: &Connection,
        terms: &[String],
        limit: i64,
    ) -> Result<Vec<LikeTaskRow>, AppError> {
        let patterns: Vec<String> = terms.iter().map(|t| like_pattern(t)).collect();
        let clauses: Vec<String> = (1..=patterns.len())
            .map(|i| format!("(title LIKE ?{i} ESCAPE '\\' OR note LIKE ?{i} ESCAPE '\\')"))
            .collect();
        let sql = format!(
            "SELECT id, title, note FROM tasks \
             WHERE deleted_at IS NULL AND {} \
             ORDER BY updated_at DESC, id LIMIT ?{}",
            clauses.join(" AND "),
            patterns.len() + 1,
        );
        let mut params: Vec<&dyn ToSql> = patterns.iter().map(|p| p as &dyn ToSql).collect();
        params.push(&limit);
        query_all(conn, &sql, &params, |row| {
            Ok(LikeTaskRow {
                id: parse_uuid(row.get("id")?)?,
                title: row.get("title")?,
                note: row.get("note")?,
            })
        })
    }

    /// Comments on live tasks whose body contains every term.
    pub fn like_comments(
        conn: &Connection,
        terms: &[String],
        limit: i64,
    ) -> Result<Vec<LikeCommentRow>, AppError> {
        let patterns: Vec<String> = terms.iter().map(|t| like_pattern(t)).collect();
        let clauses: Vec<String> = (1..=patterns.len())
            .map(|i| format!("c.body LIKE ?{i} ESCAPE '\\'"))
            .collect();
        let sql = format!(
            "SELECT c.id, t.id AS task_id, t.title AS task_title, c.body \
             FROM comments c JOIN tasks t ON t.id = c.task_id \
             WHERE c.deleted_at IS NULL AND t.deleted_at IS NULL AND {} \
             ORDER BY c.updated_at DESC, c.id LIMIT ?{}",
            clauses.join(" AND "),
            patterns.len() + 1,
        );
        let mut params: Vec<&dyn ToSql> = patterns.iter().map(|p| p as &dyn ToSql).collect();
        params.push(&limit);
        query_all(conn, &sql, &params, |row| {
            Ok(LikeCommentRow {
                id: parse_uuid(row.get("id")?)?,
                task_id: parse_uuid(row.get("task_id")?)?,
                task_title: row.get("task_title")?,
                body: row.get("body")?,
            })
        })
    }
}

/// Comment CRUD (`comments` table), always scoped to a parent task. Bodies
/// are indexed for full-text search by the V2 triggers; soft-deleted rows
/// stay in the index and are filtered at query time.
pub mod comments {
    use super::*;

    pub fn insert(conn: &Connection, comment: &Comment) -> Result<(), AppError> {
        conn.execute(
            "INSERT INTO comments (id, task_id, body, created_at, updated_at, deleted_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                comment.id.to_string(),
                comment.task_id.to_string(),
                comment.body,
                comment.created_at,
                comment.updated_at,
                comment.deleted_at,
            ],
        )?;
        Ok(())
    }

    pub fn get(conn: &Connection, id: Uuid) -> Result<Option<Comment>, AppError> {
        query_one(
            conn,
            &format!("SELECT {COMMENT_COLUMNS} FROM comments WHERE id = ?1 AND deleted_at IS NULL"),
            params![id.to_string()],
            comment_from_row,
        )
    }

    /// Non-deleted comments of one task, in chronological order.
    pub fn list_by_task(conn: &Connection, task_id: Uuid) -> Result<Vec<Comment>, AppError> {
        query_all(
            conn,
            &format!(
                "SELECT {COMMENT_COLUMNS} FROM comments \
                 WHERE task_id = ?1 AND deleted_at IS NULL ORDER BY created_at, id"
            ),
            params![task_id.to_string()],
            comment_from_row,
        )
    }

    /// Body-only update; returns false when the comment is missing or
    /// soft-deleted.
    pub fn update(conn: &Connection, comment: &Comment) -> Result<bool, AppError> {
        let affected = conn.execute(
            "UPDATE comments SET body = ?1, updated_at = ?2 \
             WHERE id = ?3 AND deleted_at IS NULL",
            params![comment.body, comment.updated_at, comment.id.to_string()],
        )?;
        Ok(affected == 1)
    }

    pub fn soft_delete(conn: &Connection, id: Uuid, at: DateTime<Utc>) -> Result<bool, AppError> {
        let affected = conn.execute(
            "UPDATE comments SET deleted_at = ?1, updated_at = ?1 \
             WHERE id = ?2 AND deleted_at IS NULL",
            params![at, id.to_string()],
        )?;
        Ok(affected == 1)
    }
}

/// Time-tracking CRUD (`time_entries` table), always scoped to a parent task.
/// Entries link to projects and tags through that task, so the statistics
/// layer aggregates by joining `time_entries → tasks → projects/task_tags`.
pub mod time_entries {
    use super::*;

    pub fn insert(conn: &Connection, entry: &TimeEntry) -> Result<(), AppError> {
        conn.execute(
            "INSERT INTO time_entries (id, task_id, started_at, ended_at, duration, created_at, \
             updated_at, deleted_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                entry.id.to_string(),
                entry.task_id.to_string(),
                entry.started_at,
                entry.ended_at,
                entry.duration,
                entry.created_at,
                entry.updated_at,
                entry.deleted_at,
            ],
        )?;
        Ok(())
    }

    pub fn get(conn: &Connection, id: Uuid) -> Result<Option<TimeEntry>, AppError> {
        query_one(
            conn,
            &format!(
                "SELECT {TIME_ENTRY_COLUMNS} FROM time_entries \
                 WHERE id = ?1 AND deleted_at IS NULL"
            ),
            params![id.to_string()],
            time_entry_from_row,
        )
    }

    /// Non-deleted entries of one task, most recent first.
    pub fn list_by_task(conn: &Connection, task_id: Uuid) -> Result<Vec<TimeEntry>, AppError> {
        query_all(
            conn,
            &format!(
                "SELECT {TIME_ENTRY_COLUMNS} FROM time_entries \
                 WHERE task_id = ?1 AND deleted_at IS NULL \
                 ORDER BY started_at DESC, created_at DESC, id"
            ),
            params![task_id.to_string()],
            time_entry_from_row,
        )
    }

    /// The task's running entry (`ended_at IS NULL`), if its timer is on.
    pub fn get_running(conn: &Connection, task_id: Uuid) -> Result<Option<TimeEntry>, AppError> {
        query_one(
            conn,
            &format!(
                "SELECT {TIME_ENTRY_COLUMNS} FROM time_entries \
                 WHERE task_id = ?1 AND ended_at IS NULL AND deleted_at IS NULL \
                 ORDER BY started_at DESC, id LIMIT 1"
            ),
            params![task_id.to_string()],
            time_entry_from_row,
        )
    }

    /// Rewrites start/end/duration; returns false when the entry is missing or
    /// soft-deleted.
    pub fn update(conn: &Connection, entry: &TimeEntry) -> Result<bool, AppError> {
        let affected = conn.execute(
            "UPDATE time_entries SET started_at = ?1, ended_at = ?2, duration = ?3, \
             updated_at = ?4 WHERE id = ?5 AND deleted_at IS NULL",
            params![
                entry.started_at,
                entry.ended_at,
                entry.duration,
                entry.updated_at,
                entry.id.to_string(),
            ],
        )?;
        Ok(affected == 1)
    }

    pub fn soft_delete(conn: &Connection, id: Uuid, at: DateTime<Utc>) -> Result<bool, AppError> {
        let affected = conn.execute(
            "UPDATE time_entries SET deleted_at = ?1, updated_at = ?1 \
             WHERE id = ?2 AND deleted_at IS NULL",
            params![at, id.to_string()],
        )?;
        Ok(affected == 1)
    }
}

/// Read-only aggregation for the statistics commands (`stats:*`).
///
/// Every query is range-filtered on an indexed timestamp column
/// (`tasks.completed_at`, `time_entries.started_at`) and only *buckets* by a
/// computed local date, so the scan stays index-supported. Timestamps go in
/// as bound `DateTime` parameters — the same encoding the write paths use —
/// never as string literals, whose timezone suffix would compare differently.
pub mod stats {
    use super::*;
    use crate::models::{
        ProjectProgress, StatsGranularity, TimeDistributionQuery, TimeGroupBy, TimePoint,
        TimeShare, TrendPoint, TrendQuery,
    };

    /// SQLite date modifier shifting stored UTC instants into the caller's
    /// local frame. Built from an integer, so it carries no injection surface,
    /// and bound as a parameter rather than interpolated.
    fn offset_modifier(offset_minutes: i32) -> String {
        format!("{offset_minutes:+} minutes")
    }

    /// Bucket key for `column`: the local date (day), the local Monday of
    /// that week, or the local month.
    fn bucket(column: &str, granularity: StatsGranularity, offset_param: usize) -> String {
        match granularity {
            StatsGranularity::Day => format!("date({column}, ?{offset_param})"),
            StatsGranularity::Week => {
                format!("date({column}, ?{offset_param}, '-6 days', 'weekday 1')")
            }
            StatsGranularity::Month => format!("strftime('%Y-%m', {column}, ?{offset_param})"),
        }
    }

    /// Completions per period bucket, ascending.
    pub fn completion_trend(
        conn: &Connection,
        query: &TrendQuery,
    ) -> Result<Vec<TrendPoint>, AppError> {
        query_all(
            conn,
            &trend_sql(query.granularity),
            params![query.from, query.to, offset_modifier(query.offset_minutes)],
            |row| {
                Ok(TrendPoint {
                    bucket: row.get("bucket")?,
                    completed: row.get("completed")?,
                })
            },
        )
    }

    /// The trend query; `completed_at`'s range predicate is what lets SQLite
    /// walk `idx_tasks_completed_at` instead of the table (see the module
    /// tests' query-plan assertions).
    fn trend_sql(granularity: StatsGranularity) -> String {
        format!(
            "SELECT {} AS bucket, COUNT(*) AS completed FROM tasks \
             WHERE deleted_at IS NULL AND completed_at >= ?1 AND completed_at < ?2 \
             GROUP BY bucket ORDER BY bucket",
            bucket("completed_at", granularity, 3)
        )
    }

    /// Tracked seconds per period bucket, ascending.
    pub fn time_buckets(
        conn: &Connection,
        query: &TimeDistributionQuery,
    ) -> Result<Vec<TimePoint>, AppError> {
        query_all(
            conn,
            &time_buckets_sql(query.granularity),
            params![query.from, query.to, offset_modifier(query.offset_minutes)],
            |row| {
                Ok(TimePoint {
                    bucket: row.get("bucket")?,
                    seconds: row.get("seconds")?,
                })
            },
        )
    }

    /// The period series query, index-backed on `time_entries.started_at`.
    fn time_buckets_sql(granularity: StatsGranularity) -> String {
        format!(
            "SELECT {} AS bucket, SUM(e.duration) AS seconds \
             FROM time_entries e JOIN tasks t ON t.id = e.task_id \
             WHERE e.deleted_at IS NULL AND t.deleted_at IS NULL \
               AND e.started_at >= ?1 AND e.started_at < ?2 \
             GROUP BY bucket ORDER BY bucket",
            bucket("e.started_at", granularity, 3)
        )
    }

    /// Tracked time per project or tag over the range, longest first. A task
    /// carrying several tags contributes its time to each of them, and time on
    /// project-less (inbox) tasks forms a share with no id.
    pub fn time_shares(
        conn: &Connection,
        query: &TimeDistributionQuery,
    ) -> Result<Vec<TimeShare>, AppError> {
        query_all(
            conn,
            time_shares_sql(query.group_by),
            params![query.from, query.to],
            |row| {
                let id: Option<String> = row.get("id")?;
                Ok(TimeShare {
                    id: id.map(parse_uuid).transpose()?,
                    name: row.get("name")?,
                    seconds: row.get("seconds")?,
                })
            },
        )
    }

    /// The grouping query, index-backed on `time_entries.started_at`; ties
    /// fall back to name order (id-less shares last).
    fn time_shares_sql(group_by: TimeGroupBy) -> &'static str {
        match group_by {
            TimeGroupBy::Project => {
                "SELECT t.project_id AS id, p.name AS name, SUM(e.duration) AS seconds \
                 FROM time_entries e \
                 JOIN tasks t ON t.id = e.task_id \
                 LEFT JOIN projects p ON p.id = t.project_id \
                 WHERE e.deleted_at IS NULL AND t.deleted_at IS NULL \
                   AND e.started_at >= ?1 AND e.started_at < ?2 \
                 GROUP BY t.project_id \
                 ORDER BY seconds DESC, name IS NULL, name COLLATE NOCASE"
            }
            TimeGroupBy::Tag => {
                "SELECT g.id AS id, g.name AS name, SUM(e.duration) AS seconds \
                 FROM time_entries e \
                 JOIN tasks t ON t.id = e.task_id \
                 JOIN task_tags tt ON tt.task_id = t.id \
                 JOIN tags g ON g.id = tt.tag_id AND g.deleted_at IS NULL \
                 WHERE e.deleted_at IS NULL AND t.deleted_at IS NULL \
                   AND e.started_at >= ?1 AND e.started_at < ?2 \
                 GROUP BY g.id \
                 ORDER BY seconds DESC, name COLLATE NOCASE"
            }
        }
    }

    /// Every live project's task tally, by name. Archived projects are left
    /// out — they are out of the current picture and restoring brings them
    /// back; completion rate and remaining count derive from the tally.
    pub fn project_progress(conn: &Connection) -> Result<Vec<ProjectProgress>, AppError> {
        query_all(conn, PROJECT_PROGRESS_SQL, &[], |row| {
            Ok(ProjectProgress {
                project_id: parse_uuid(row.get("project_id")?)?,
                name: row.get("name")?,
                total: row.get("total")?,
                completed: row.get("completed")?,
                due_at: row.get("due_at")?,
            })
        })
    }

    /// Project tally query; the join walks `idx_tasks_project`.
    const PROJECT_PROGRESS_SQL: &str =
        "SELECT p.id AS project_id, p.name AS name, p.due_at AS due_at, \
                COUNT(t.id) AS total, COUNT(t.completed_at) AS completed \
         FROM projects p \
         LEFT JOIN tasks t ON t.project_id = p.id AND t.deleted_at IS NULL \
         WHERE p.deleted_at IS NULL AND p.status = 'active' \
         GROUP BY p.id ORDER BY p.name COLLATE NOCASE, p.id";

    #[cfg(test)]
    mod tests {
        use super::*;
        use crate::db;
        use rusqlite::params_from_iter;
        use rusqlite::types::Value;

        /// The planner's explanation of `sql`, one detail line per step. The
        /// statements take their range/modifier parameters even while only
        /// being explained, so they are bound with representative values.
        fn plan(conn: &Connection, sql: &str, bound: &[Value]) -> String {
            let mut stmt = conn
                .prepare(&format!("EXPLAIN QUERY PLAN {sql}"))
                .expect("prepare explain");
            let details = stmt
                .query_map(params_from_iter(bound.iter()), |row| {
                    row.get::<_, String>("detail")
                })
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap();
            details.join(" | ")
        }

        /// Range and offset bounds in the encoding the app stores timestamps
        /// in, so the planner sees a real (index-usable) range constraint.
        fn bounds() -> Vec<Value> {
            vec![
                Value::Text("2026-01-01 00:00:00+00:00".into()),
                Value::Text("2026-12-31 00:00:00+00:00".into()),
                Value::Text("+0 minutes".into()),
            ]
        }

        #[test]
        fn statistics_queries_are_index_backed() {
            let conn = db::test_conn();
            let bounds = bounds();

            // The statistics DoD is "aggregation SQL backed by indexes". Each
            // range predicate must *seek* its timestamp index (SEARCH, not a
            // SCAN of the table or of the whole index), and the project tally
            // must reach tasks through `idx_tasks_project`.
            let trend = plan(&conn, &trend_sql(StatsGranularity::Day), &bounds);
            assert!(
                trend.contains("SEARCH tasks USING INDEX idx_tasks_completed_at"),
                "trend does not seek idx_tasks_completed_at: {trend}"
            );

            let buckets = plan(&conn, &time_buckets_sql(StatsGranularity::Week), &bounds);
            assert!(
                buckets.contains("SEARCH e USING INDEX idx_time_entries_started_at"),
                "period series does not seek idx_time_entries_started_at: {buckets}"
            );

            let shares = plan(&conn, time_shares_sql(TimeGroupBy::Project), &bounds[..2]);
            assert!(
                shares.contains("SEARCH e USING INDEX idx_time_entries_started_at"),
                "project shares do not seek idx_time_entries_started_at: {shares}"
            );

            let progress = plan(&conn, PROJECT_PROGRESS_SQL, &[]);
            assert!(
                progress.contains("SEARCH t USING INDEX idx_tasks_project"),
                "project tally does not seek idx_tasks_project: {progress}"
            );
        }
    }
}

/// Whole-database copy for the backup commands (`backup:*`).
///
/// Every other query in this layer treats `deleted_at IS NULL` as the default
/// semantic; these two deliberately do not. A backup is a copy of the
/// database, so soft-deleted rows travel with it and come back on restore.
pub mod backup {
    use super::*;
    use crate::models::{BackupData, TaskTagLink};

    /// Every row of every user-data table.
    pub fn export_all(conn: &Connection) -> Result<BackupData, AppError> {
        Ok(BackupData {
            projects: all_rows(conn, "projects", PROJECT_COLUMNS, project_from_row)?,
            board_columns: all_rows(
                conn,
                "board_columns",
                BOARD_COLUMN_COLUMNS,
                board_column_from_row,
            )?,
            tags: all_rows(conn, "tags", TAG_COLUMNS, tag_from_row)?,
            tasks: all_rows(conn, "tasks", TASK_COLUMNS, task_from_row)?,
            subtasks: all_rows(conn, "subtasks", SUBTASK_COLUMNS, subtask_from_row)?,
            task_tags: query_all(
                conn,
                "SELECT task_id, tag_id FROM task_tags ORDER BY task_id, tag_id",
                &[],
                |row| {
                    Ok(TaskTagLink {
                        task_id: parse_uuid(row.get("task_id")?)?,
                        tag_id: parse_uuid(row.get("tag_id")?)?,
                    })
                },
            )?,
            comments: all_rows(conn, "comments", COMMENT_COLUMNS, comment_from_row)?,
            time_entries: all_rows(
                conn,
                "time_entries",
                TIME_ENTRY_COLUMNS,
                time_entry_from_row,
            )?,
            settings: all_rows(conn, "settings", SETTING_COLUMNS, setting_from_row)?,
        })
    }

    fn all_rows<T>(
        conn: &Connection,
        table: &str,
        columns: &str,
        map: RowMap<T>,
    ) -> Result<Vec<T>, AppError> {
        query_all(conn, &format!("SELECT {columns} FROM {table}"), &[], map)
    }

    /// Replaces every user-data table with `data`, inside the caller's
    /// transaction. Children are cleared before their parents and written
    /// after them, so the foreign keys hold throughout.
    pub fn replace_all(conn: &Connection, data: &BackupData) -> Result<(), AppError> {
        for table in [
            "task_tags",
            "comments",
            "subtasks",
            "time_entries",
            "tasks",
            "board_columns",
            "projects",
            "tags",
            "settings",
        ] {
            conn.execute(&format!("DELETE FROM {table}"), [])?;
        }

        for project in &data.projects {
            projects::insert(conn, project)?;
        }
        for column in &data.board_columns {
            board_columns::insert(conn, column)?;
        }
        for tag in &data.tags {
            tags::insert(conn, tag)?;
        }
        for task in &data.tasks {
            tasks::insert(conn, task)?;
        }
        for subtask in &data.subtasks {
            subtasks::insert(conn, subtask)?;
        }
        {
            let mut statement =
                conn.prepare("INSERT INTO task_tags (task_id, tag_id) VALUES (?1, ?2)")?;
            for link in &data.task_tags {
                statement.execute(params![link.task_id.to_string(), link.tag_id.to_string()])?;
            }
        }
        for comment in &data.comments {
            comments::insert(conn, comment)?;
        }
        for entry in &data.time_entries {
            time_entries::insert(conn, entry)?;
        }
        for setting in &data.settings {
            conn.execute(
                "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)",
                params![setting.key, setting.value, setting.updated_at],
            )?;
        }
        Ok(())
    }
}

/// Reminder dedup markers (`task_reminders`) and the candidate scan that
/// feeds the scheduler's reminder decisions.
pub mod reminders {
    use super::*;

    fn kind_as_text(kind: ReminderKind) -> &'static str {
        match kind {
            ReminderKind::Advance1h => "advance_1h",
            ReminderKind::Advance10m => "advance_10m",
            ReminderKind::Due => "due",
        }
    }

    /// Records that a reminder fired; returns false when a marker already
    /// existed (the `(task_id, kind)` primary key dedups via INSERT OR
    /// IGNORE).
    pub fn mark_fired(
        conn: &Connection,
        task_id: Uuid,
        kind: ReminderKind,
        at: DateTime<Utc>,
    ) -> Result<bool, AppError> {
        let affected = conn.execute(
            "INSERT OR IGNORE INTO task_reminders (task_id, kind, sent_at) VALUES (?1, ?2, ?3)",
            params![task_id.to_string(), kind_as_text(kind), at],
        )?;
        Ok(affected == 1)
    }

    /// A live, incomplete, due-dated task within the scan window.
    pub struct ReminderCandidate {
        pub id: Uuid,
        pub title: String,
        pub due_at: DateTime<Utc>,
    }

    /// Tasks whose reminders may be triggerable: not soft-deleted, not
    /// completed, `due_at` in `(cutoff, horizon]`, ordered by due time.
    pub fn list_candidates(
        conn: &Connection,
        cutoff: DateTime<Utc>,
        horizon: DateTime<Utc>,
    ) -> Result<Vec<ReminderCandidate>, AppError> {
        query_all(
            conn,
            "SELECT id, title, due_at FROM tasks \
             WHERE deleted_at IS NULL AND completed_at IS NULL \
               AND due_at IS NOT NULL AND due_at > ?1 AND due_at <= ?2 \
             ORDER BY due_at, id",
            params![cutoff, horizon],
            |row| {
                Ok(ReminderCandidate {
                    id: parse_uuid(row.get("id")?)?,
                    title: row.get("title")?,
                    due_at: row.get("due_at")?,
                })
            },
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::models::RepeatFreq;
    use chrono::TimeZone;

    fn conn() -> Connection {
        db::test_conn()
    }

    fn ts(minutes: i64) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 9, 9, 10, 0, 0).unwrap() + chrono::Duration::minutes(minutes)
    }

    fn sample_task(sort_order: &str) -> Task {
        Task {
            id: Uuid::new_v4(),
            project_id: None,
            title: "写周报".into(),
            note: None,
            priority: Priority::Medium,
            column_id: None,
            due_at: None,
            completed_at: None,
            repeat_rule: None,
            sort_order: sort_order.into(),
            created_at: ts(0),
            updated_at: ts(0),
            deleted_at: None,
        }
    }

    fn sample_tag(name: &str) -> Tag {
        Tag {
            id: Uuid::new_v4(),
            name: name.into(),
            color: None,
            created_at: ts(0),
            updated_at: ts(0),
            deleted_at: None,
        }
    }

    fn sample_subtask(task_id: Uuid, sort_order: &str) -> Subtask {
        Subtask {
            id: Uuid::new_v4(),
            task_id,
            title: "收集数据".into(),
            done: false,
            sort_order: sort_order.into(),
            created_at: ts(0),
            updated_at: ts(0),
            deleted_at: None,
        }
    }

    fn sample_project(sort_order: &str) -> Project {
        Project {
            id: Uuid::new_v4(),
            name: "网站改版".into(),
            description: None,
            color: None,
            icon: None,
            due_at: None,
            status: ProjectStatus::Active,
            sort_order: sort_order.into(),
            created_at: ts(0),
            updated_at: ts(0),
            deleted_at: None,
        }
    }

    fn sample_column(project_id: Uuid, position: &str, is_done: bool) -> BoardColumn {
        BoardColumn {
            id: Uuid::new_v4(),
            project_id,
            name: "待办".into(),
            position: position.into(),
            is_done,
            created_at: ts(0),
            updated_at: ts(0),
            deleted_at: None,
        }
    }

    #[test]
    fn task_round_trips_through_the_database() {
        let conn = conn();
        let task = sample_task("n");
        tasks::insert(&conn, &task).unwrap();

        assert_eq!(tasks::get(&conn, task.id).unwrap().unwrap(), task);
        assert_eq!(tasks::list(&conn).unwrap(), vec![task.clone()]);
        assert_eq!(tasks::get(&conn, Uuid::new_v4()).unwrap(), None);
    }

    #[test]
    fn task_update_persists_every_field() {
        let conn = conn();
        let task = sample_task("n");
        tasks::insert(&conn, &task).unwrap();

        // A real project/column pair, because the FKs are enforced.
        let project_id = Uuid::new_v4();
        conn.execute(
            "INSERT INTO projects (id, name, status, sort_order, created_at, updated_at) \
             VALUES (?1, '项目', 'active', 'n', ?2, ?2)",
            params![project_id.to_string(), ts(0)],
        )
        .unwrap();
        let column_id = Uuid::new_v4();
        conn.execute(
            "INSERT INTO board_columns (id, project_id, name, position, is_done, created_at, \
             updated_at) VALUES (?1, ?2, '待办', 'n', 0, ?3, ?3)",
            params![column_id.to_string(), project_id.to_string(), ts(0)],
        )
        .unwrap();

        let mut edited = task.clone();
        edited.project_id = Some(project_id);
        edited.title = "评审会".into();
        edited.note = Some("带笔记本".into());
        edited.priority = Priority::High;
        edited.column_id = Some(column_id);
        edited.due_at = Some(ts(30) + chrono::Duration::milliseconds(500));
        edited.completed_at = Some(ts(31));
        edited.repeat_rule = Some(RepeatRule {
            freq: RepeatFreq::Weekly,
            interval: 2,
            paused: false,
        });
        edited.updated_at = ts(5);

        assert!(tasks::update(&conn, &edited).unwrap());
        assert_eq!(tasks::get(&conn, task.id).unwrap().unwrap(), edited);
    }

    #[test]
    fn task_update_returns_false_for_missing_task() {
        let conn = conn();
        assert!(!tasks::update(&conn, &sample_task("n")).unwrap());
    }

    #[test]
    fn task_list_orders_by_sort_order() {
        let conn = conn();
        let mid = sample_task("n");
        let last = sample_task("t");
        let first = sample_task("a");
        for task in [&mid, &last, &first] {
            tasks::insert(&conn, task).unwrap();
        }

        let listed = tasks::list(&conn).unwrap();
        assert_eq!(listed, vec![first, mid, last]);
    }

    #[test]
    fn task_soft_delete_filters_and_restore_brings_back() {
        let conn = conn();
        let task_a = sample_task("a");
        let task_b = sample_task("n");
        tasks::insert(&conn, &task_a).unwrap();
        tasks::insert(&conn, &task_b).unwrap();

        assert!(tasks::soft_delete(&conn, task_a.id, ts(10)).unwrap());
        // Deleting twice is a no-op.
        assert!(!tasks::soft_delete(&conn, task_a.id, ts(11)).unwrap());
        // Soft-deleted rows vanish from get/list and cannot be updated.
        assert_eq!(tasks::get(&conn, task_a.id).unwrap(), None);
        assert_eq!(tasks::list(&conn).unwrap(), vec![task_b.clone()]);
        assert!(!tasks::update(&conn, &task_a).unwrap());

        assert!(tasks::restore(&conn, task_a.id, ts(20)).unwrap());
        assert!(!tasks::restore(&conn, task_a.id, ts(21)).unwrap());
        // The restore stamped updated_at; everything else is untouched.
        let mut restored = task_a.clone();
        restored.updated_at = ts(20);
        assert_eq!(tasks::list(&conn).unwrap(), vec![restored, task_b]);
    }

    #[test]
    fn tag_crud_with_case_insensitive_unique_name() {
        let conn = conn();
        let mut tag = sample_tag("工作");
        tag.color = Some("#ff5500".into());
        tags::insert(&conn, &tag).unwrap();

        assert_eq!(tags::get(&conn, tag.id).unwrap().unwrap(), tag);
        // NOCASE lookup finds the tag regardless of the query's case.
        let found = tags::find_by_name(&conn, "工作").unwrap().unwrap();
        assert_eq!(found.id, tag.id);

        let tag_b = sample_tag("Inbox");
        tags::insert(&conn, &tag_b).unwrap();
        // NOCASE ordering: "Inbox" sorts before "工作" (ASCII < CJK).
        assert_eq!(tags::list(&conn).unwrap(), vec![tag_b.clone(), tag.clone()]);

        // Duplicate name (case-insensitive) violates the UNIQUE constraint.
        let dupe = sample_tag("工作");
        assert!(tags::insert(&conn, &dupe).is_err());
        let dupe_case = sample_tag("INBOX");
        assert!(tags::insert(&conn, &dupe_case).is_err());

        let mut edited = tag.clone();
        edited.name = "生活".into();
        edited.updated_at = ts(3);
        assert!(tags::update(&conn, &edited).unwrap());
        assert_eq!(tags::find_by_name(&conn, "生活").unwrap().unwrap(), edited);

        assert!(tags::soft_delete(&conn, tag.id, ts(4)).unwrap());
        assert_eq!(tags::get(&conn, tag.id).unwrap(), None);
        assert_eq!(tags::find_by_name(&conn, "生活").unwrap(), None);
        assert_eq!(tags::list(&conn).unwrap(), vec![tag_b]);
    }

    #[test]
    fn subtasks_are_scoped_to_their_task_and_ordered() {
        let conn = conn();
        let task_1 = sample_task("n");
        let task_2 = sample_task("n");
        tasks::insert(&conn, &task_1).unwrap();
        tasks::insert(&conn, &task_2).unwrap();

        let mid = sample_subtask(task_1.id, "n");
        let first = sample_subtask(task_1.id, "a");
        let other_task = sample_subtask(task_2.id, "n");
        for subtask in [&mid, &first, &other_task] {
            subtasks::insert(&conn, subtask).unwrap();
        }

        assert_eq!(
            subtasks::list_by_task(&conn, task_1.id).unwrap(),
            vec![first.clone(), mid.clone()]
        );
        assert_eq!(
            subtasks::list_by_task(&conn, task_2.id).unwrap(),
            vec![other_task]
        );

        let mut edited = first.clone();
        edited.done = true;
        edited.title = "收集全部数据".into();
        edited.updated_at = ts(2);
        assert!(subtasks::update(&conn, &edited).unwrap());
        assert_eq!(subtasks::get(&conn, first.id).unwrap().unwrap(), edited);

        assert!(subtasks::soft_delete(&conn, mid.id, ts(3)).unwrap());
        assert_eq!(
            subtasks::list_by_task(&conn, task_1.id).unwrap(),
            vec![edited]
        );
    }

    #[test]
    fn task_tag_associations_replace_and_filter_deleted_tags() {
        let conn = conn();
        let task = sample_task("n");
        tasks::insert(&conn, &task).unwrap();
        let tag_a = sample_tag("urgent");
        let tag_b = sample_tag("later");
        let tag_c = sample_tag("work");
        for tag in [&tag_a, &tag_b, &tag_c] {
            tags::insert(&conn, tag).unwrap();
        }

        task_tags::set_task_tags(&conn, task.id, &[tag_a.id, tag_b.id, tag_c.id]).unwrap();
        // Association listing is ordered by tag name, not insertion order.
        assert_eq!(
            task_tags::list_tags_for_task(&conn, task.id).unwrap(),
            vec![tag_b.clone(), tag_a.clone(), tag_c.clone()]
        );

        // Replacing drops the old set.
        task_tags::set_task_tags(&conn, task.id, &[tag_a.id]).unwrap();
        assert_eq!(
            task_tags::list_tags_for_task(&conn, task.id).unwrap(),
            vec![tag_a.clone()]
        );

        // Unknown tag ids are rejected by the foreign key. Without a wrapping
        // transaction the delete has already run, so the task is left with no
        // tags; services always call this inside a transaction.
        assert!(task_tags::set_task_tags(&conn, task.id, &[Uuid::new_v4()]).is_err());
        assert_eq!(
            task_tags::list_tags_for_task(&conn, task.id).unwrap(),
            Vec::<Tag>::new()
        );

        // Soft-deleting a tag hides it from task associations.
        task_tags::set_task_tags(&conn, task.id, &[tag_b.id]).unwrap();
        assert!(tags::soft_delete(&conn, tag_b.id, ts(5)).unwrap());
        assert_eq!(
            task_tags::list_tags_for_task(&conn, task.id).unwrap(),
            Vec::<Tag>::new()
        );
    }

    #[test]
    fn project_round_trips_and_orders_by_sort_order() {
        let conn = conn();
        let mid = sample_project("n");
        let last = sample_project("t");
        let first = sample_project("a");
        for project in [&mid, &last, &first] {
            projects::insert(&conn, project).unwrap();
        }

        assert_eq!(projects::get(&conn, first.id).unwrap().unwrap(), first);
        assert_eq!(projects::get(&conn, Uuid::new_v4()).unwrap(), None);
        assert_eq!(projects::list(&conn).unwrap(), vec![first, mid, last]);
    }

    #[test]
    fn project_update_persists_every_field() {
        let conn = conn();
        let project = sample_project("n");
        projects::insert(&conn, &project).unwrap();

        let mut edited = project.clone();
        edited.name = "App 重构".into();
        edited.description = Some("迁移到新框架".into());
        edited.color = Some("#3b82f6".into());
        edited.icon = Some("rocket".into());
        edited.due_at = Some(ts(30));
        edited.status = ProjectStatus::Archived;
        edited.sort_order = "p".into();
        edited.updated_at = ts(5);
        assert!(projects::update(&conn, &edited).unwrap());
        assert_eq!(projects::get(&conn, project.id).unwrap().unwrap(), edited);
    }

    #[test]
    fn project_update_returns_false_for_missing_project() {
        let conn = conn();
        assert!(!projects::update(&conn, &sample_project("n")).unwrap());
    }

    #[test]
    fn project_archive_and_restore_flip_status() {
        let conn = conn();
        let project = sample_project("n");
        projects::insert(&conn, &project).unwrap();

        // Archiving stamps updated_at and switches the status, but the row
        // stays listed (archived is a state, not a soft delete).
        assert!(projects::set_status(&conn, project.id, ProjectStatus::Archived, ts(10)).unwrap());
        let archived = projects::get(&conn, project.id).unwrap().unwrap();
        assert_eq!(archived.status, ProjectStatus::Archived);
        assert_eq!(archived.updated_at, ts(10));
        assert_eq!(projects::list(&conn).unwrap().len(), 1);

        // Archiving twice is a no-op, and unknown ids report false.
        assert!(!projects::set_status(&conn, project.id, ProjectStatus::Archived, ts(11)).unwrap());
        assert!(
            !projects::set_status(&conn, Uuid::new_v4(), ProjectStatus::Archived, ts(11)).unwrap()
        );

        assert!(projects::set_status(&conn, project.id, ProjectStatus::Active, ts(20)).unwrap());
        let restored = projects::get(&conn, project.id).unwrap().unwrap();
        assert_eq!(restored.status, ProjectStatus::Active);
        assert_eq!(restored.updated_at, ts(20));
    }

    #[test]
    fn board_column_crud_is_scoped_ordered_and_soft_deletes() {
        let conn = conn();
        let project_a = sample_project("n");
        let project_b = sample_project("t");
        projects::insert(&conn, &project_a).unwrap();
        projects::insert(&conn, &project_b).unwrap();

        let mid = sample_column(project_a.id, "n", false);
        let first = sample_column(project_a.id, "a", false);
        let done = BoardColumn {
            name: "已完成".into(),
            is_done: true,
            ..sample_column(project_a.id, "z", false)
        };
        let other_project = sample_column(project_b.id, "n", false);
        for column in [&mid, &first, &done, &other_project] {
            board_columns::insert(&conn, column).unwrap();
        }

        // Unknown projects are rejected by the foreign key.
        assert!(board_columns::insert(&conn, &sample_column(Uuid::new_v4(), "n", false)).is_err());

        assert_eq!(
            board_columns::list_by_project(&conn, project_a.id).unwrap(),
            vec![first.clone(), mid.clone(), done.clone()]
        );
        assert_eq!(
            board_columns::list_by_project(&conn, project_b.id).unwrap(),
            vec![other_project]
        );
        assert_eq!(board_columns::get(&conn, done.id).unwrap().unwrap(), done);

        // Full-row update covers the rename/reposition/is_done toggle.
        let mut edited = first.clone();
        edited.name = "进行中".into();
        edited.position = "m".into();
        edited.is_done = false;
        edited.updated_at = ts(2);
        assert!(board_columns::update(&conn, &edited).unwrap());
        assert_eq!(
            board_columns::get(&conn, first.id).unwrap().unwrap(),
            edited
        );

        // Targeted position write for service-level rebalances.
        assert!(board_columns::set_position(&conn, mid.id, "q", ts(3)).unwrap());
        assert_eq!(
            board_columns::get(&conn, mid.id).unwrap().unwrap().position,
            "q"
        );
        assert!(!board_columns::set_position(&conn, Uuid::new_v4(), "q", ts(3)).unwrap());

        // Soft delete hides the column from its project's board.
        assert!(board_columns::soft_delete(&conn, mid.id, ts(4)).unwrap());
        assert!(!board_columns::soft_delete(&conn, mid.id, ts(5)).unwrap());
        assert_eq!(board_columns::get(&conn, mid.id).unwrap(), None);
        assert_eq!(
            board_columns::list_by_project(&conn, project_a.id).unwrap(),
            vec![edited, done]
        );
    }

    fn insert_comment(conn: &Connection, task_id: Uuid, body: &str) {
        conn.execute(
            "INSERT INTO comments (id, task_id, body, created_at, updated_at) \
             VALUES (?1, ?2, ?3, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            params![Uuid::new_v4().to_string(), task_id.to_string(), body],
        )
        .unwrap();
    }

    fn sample_comment(task_id: Uuid, body: &str, created_at: chrono::DateTime<Utc>) -> Comment {
        Comment {
            id: Uuid::new_v4(),
            task_id,
            body: body.into(),
            created_at,
            updated_at: created_at,
            deleted_at: None,
        }
    }

    #[test]
    fn comments_crud_scope_and_soft_delete() {
        let conn = conn();
        let task_a = sample_task("a");
        let task_b = sample_task("n");
        tasks::insert(&conn, &task_a).unwrap();
        tasks::insert(&conn, &task_b).unwrap();

        let first = sample_comment(task_a.id, "第一条", ts(0));
        let second = sample_comment(task_a.id, "第二条", ts(1));
        let other = sample_comment(task_b.id, "别的任务", ts(2));
        for comment in [&first, &second, &other] {
            comments::insert(&conn, comment).unwrap();
        }

        // Chronological within the task, scoped to it.
        assert_eq!(
            comments::list_by_task(&conn, task_a.id).unwrap(),
            vec![first.clone(), second.clone()]
        );
        assert_eq!(comments::get(&conn, first.id).unwrap().unwrap(), first);

        // Body-only update stamps updated_at and skips soft-deleted rows.
        let mut edited = second.clone();
        edited.body = "第二条（修订）".into();
        edited.updated_at = ts(5);
        assert!(comments::update(&conn, &edited).unwrap());
        assert_eq!(comments::get(&conn, second.id).unwrap().unwrap(), edited);
        assert!(!comments::update(&conn, &sample_comment(Uuid::new_v4(), "缺失", ts(0))).unwrap());

        assert!(comments::soft_delete(&conn, first.id, ts(10)).unwrap());
        assert!(!comments::soft_delete(&conn, first.id, ts(11)).unwrap());
        assert_eq!(comments::get(&conn, first.id).unwrap(), None);
        assert_eq!(
            comments::list_by_task(&conn, task_a.id).unwrap(),
            vec![edited]
        );
    }

    #[test]
    fn fts_task_search_marks_snippets_and_filters_soft_deleted() {
        let conn = conn();
        let mut hit = sample_task("a");
        hit.title = "设计评审会议".into();
        hit.note = Some("带上原型稿".into());
        let mut deleted = sample_task("n");
        deleted.title = "设计评审归档".into();
        let other = sample_task("t");
        for task in [&hit, &deleted, &other] {
            tasks::insert(&conn, task).unwrap();
        }
        tasks::soft_delete(&conn, deleted.id, ts(1)).unwrap();

        let hits = search::fts_tasks(&conn, "\"设计评审\"", 10).unwrap();
        assert_eq!(hits.len(), 1, "soft-deleted rows stay indexed but filtered");
        assert_eq!(hits[0].id, hit.id);
        assert_eq!(hits[0].title, "设计评审会议");
        assert!(hits[0].snippet.contains("<mark>设计评审</mark>"));

        // Note-only hits come back with the snippet from the note column.
        let hits = search::fts_tasks(&conn, "\"带上原型稿\"", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].id, hit.id);
        assert!(hits[0].snippet.contains("<mark>带上原型稿</mark>"));
    }

    #[test]
    fn fts_comment_search_resolves_the_parent_task_and_filters_deletes() {
        let conn = conn();
        let live = sample_task("a");
        let gone = sample_task("n");
        tasks::insert(&conn, &live).unwrap();
        tasks::insert(&conn, &gone).unwrap();
        tasks::soft_delete(&conn, gone.id, ts(1)).unwrap();

        insert_comment(&conn, live.id, "评审意见：交互再简化");
        insert_comment(&conn, gone.id, "评审意见：旧任务的评论");
        insert_comment(&conn, live.id, "无匹配内容");

        let hits = search::fts_comments(&conn, "\"评审意见\"", 10).unwrap();
        assert_eq!(hits.len(), 1, "comments on deleted tasks are filtered");
        assert_eq!(hits[0].task_id, live.id);
        assert_eq!(hits[0].task_title, live.title);
        assert!(hits[0].snippet.contains("<mark>评审意见</mark>"));
    }

    #[test]
    fn like_fallback_escapes_wildcards_and_ands_terms() {
        let conn = conn();
        let mut percent = sample_task("a");
        percent.title = "进度50%更新".into();
        percent.note = Some("下划线_备注".into());
        let mut plain = sample_task("n");
        plain.title = "进度完成".into();
        for task in [&percent, &plain] {
            tasks::insert(&conn, task).unwrap();
        }

        // `%`/`_` in the query are literals, not wildcards.
        let hits = search::like_tasks(&conn, &["50%".to_string()], 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].id, percent.id);
        let hits = search::like_tasks(&conn, &["_备".to_string()], 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].id, percent.id);
        assert_eq!(hits[0].note.as_deref(), Some("下划线_备注"));

        // Every term must occur in title or note.
        let hits = search::like_tasks(&conn, &["50%".to_string(), "_备".to_string()], 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].id, percent.id);
        let hits = search::like_tasks(&conn, &["进度".to_string()], 10).unwrap();
        assert_eq!(hits.len(), 2);

        insert_comment(&conn, percent.id, "成本_a 讨论");
        insert_comment(&conn, plain.id, "普通评论");
        let hits = search::like_comments(&conn, &["_a".to_string()], 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].task_id, percent.id);
        assert_eq!(hits[0].task_title, percent.title);
    }

    #[test]
    fn reminder_markers_dedup_and_candidates_filter_the_window() {
        let conn = conn();
        let mut task = sample_task("a");
        task.title = "到期任务".into();
        task.due_at = Some(ts(60));
        let mut done = sample_task("n");
        done.due_at = Some(ts(30));
        done.completed_at = Some(ts(10));
        let mut gone = sample_task("t");
        gone.due_at = Some(ts(30));
        let mut undated = sample_task("z");
        undated.due_at = None;
        for entry in [&task, &done, &gone, &undated] {
            tasks::insert(&conn, entry).unwrap();
        }
        tasks::soft_delete(&conn, gone.id, ts(5)).unwrap();

        // Only the live, incomplete task inside the window is a candidate.
        let candidates = reminders::list_candidates(&conn, ts(0), ts(120)).unwrap();
        assert_eq!(
            candidates.iter().map(|c| c.id).collect::<Vec<_>>(),
            vec![task.id]
        );
        assert_eq!(candidates[0].title, "到期任务");
        assert_eq!(candidates[0].due_at, ts(60));

        // Markers dedup on the (task, kind) primary key; kinds are independent.
        assert!(reminders::mark_fired(&conn, task.id, ReminderKind::Advance1h, ts(61)).unwrap());
        assert!(!reminders::mark_fired(&conn, task.id, ReminderKind::Advance1h, ts(62)).unwrap());
        assert!(reminders::mark_fired(&conn, task.id, ReminderKind::Due, ts(63)).unwrap());
    }
}
