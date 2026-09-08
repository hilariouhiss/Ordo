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
use crate::models::{Priority, RepeatRule, Subtask, Tag, Task};

const TASK_COLUMNS: &str = "id, project_id, title, note, priority, column_id, due_at, \
                            completed_at, repeat_rule, sort_order, created_at, updated_at, \
                            deleted_at";
const TAG_COLUMNS: &str = "id, name, color, created_at, updated_at, deleted_at";
const SUBTASK_COLUMNS: &str = "id, task_id, title, done, sort_order, created_at, updated_at, \
                               deleted_at";

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
}
