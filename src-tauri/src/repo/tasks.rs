use crate::dto::{DelayDto, StepDto, TagDto, TaskDto};
use rusqlite::{params, Connection};

pub fn insert(conn: &Connection, id: &str, title: &str, now: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO tasks (id, title, status, in_week, carry_count, created_at, updated_at)
         VALUES (?1, ?2, 'todo', 1, 0, ?3, ?3)",
        params![id, title, now],
    )?;
    Ok(())
}

pub fn list_week_ids(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT id FROM tasks
         WHERE in_week = 1 AND canceled_at IS NULL AND archived_at IS NULL AND deleted_at IS NULL
         ORDER BY due_date IS NULL, due_date, created_at",
    )?;
    let rows = stmt.query_map([], |r| r.get(0))?;
    rows.collect()
}

pub fn list_week(conn: &Connection) -> rusqlite::Result<Vec<TaskDto>> {
    list_week_ids(conn)?
        .iter()
        .map(|id| dto(conn, id))
        .collect()
}

pub fn dto(conn: &Connection, id: &str) -> rusqlite::Result<TaskDto> {
    let mut task = conn.query_row(
        "SELECT id, title, project_id, category_id, owner_id, start_date, due_date, status,
                in_week, carry_count, suspended_until, note, archived_at, canceled_at,
                created_at, updated_at
         FROM tasks WHERE id = ?1",
        [id],
        |r| {
            Ok(TaskDto {
                id: r.get(0)?,
                title: r.get(1)?,
                project_id: r.get(2)?,
                category_id: r.get(3)?,
                owner_id: r.get(4)?,
                start_date: r.get(5)?,
                due_date: r.get(6)?,
                status: r.get(7)?,
                in_week: r.get::<_, i64>(8)? == 1,
                carry_count: r.get(9)?,
                suspended_until: r.get(10)?,
                note: r.get(11)?,
                archived_at: r.get(12)?,
                canceled_at: r.get(13)?,
                steps: vec![],
                tags: vec![],
                delays: vec![],
                created_at: r.get(14)?,
                updated_at: r.get(15)?,
            })
        },
    )?;

    let mut steps = conn.prepare(
        "SELECT id, task_id, title, sort_order, done, due_date FROM steps
         WHERE task_id = ?1 AND deleted_at IS NULL ORDER BY sort_order",
    )?;
    task.steps = steps
        .query_map([id], |r| {
            Ok(StepDto {
                id: r.get(0)?,
                task_id: r.get(1)?,
                title: r.get(2)?,
                sort_order: r.get(3)?,
                done: r.get::<_, i64>(4)? == 1,
                due_date: r.get(5)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut tags = conn.prepare(
        "SELECT t.id, t.name FROM tags t JOIN task_tags tt ON tt.tag_id = t.id
         WHERE tt.task_id = ?1 AND t.deleted_at IS NULL ORDER BY t.name",
    )?;
    task.tags = tags
        .query_map([id], |r| {
            Ok(TagDto {
                id: r.get(0)?,
                name: r.get(1)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut delays = conn.prepare(
        "SELECT id, task_id, kind, old_due, new_due, reason, created_at FROM delays
         WHERE task_id = ?1 ORDER BY created_at",
    )?;
    task.delays = delays
        .query_map([id], |r| {
            Ok(DelayDto {
                id: r.get(0)?,
                task_id: r.get(1)?,
                kind: r.get(2)?,
                old_due: r.get(3)?,
                new_due: r.get(4)?,
                reason: r.get(5)?,
                created_at: r.get(6)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(task)
}
pub fn stored_status(conn: &Connection, id: &str) -> rusqlite::Result<String> {
    conn.query_row("SELECT status FROM tasks WHERE id = ?1", [id], |r| r.get(0))
}

pub fn set_status(
    conn: &Connection,
    id: &str,
    status: &str,
    leave_week: bool,
    now: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE tasks SET status = ?1, in_week = CASE WHEN ?2 THEN 0 ELSE in_week END, updated_at = ?3 WHERE id = ?4",
        params![status, leave_week as i64, now, id],
    )?;
    Ok(())
}

pub fn update_fields(
    conn: &Connection,
    id: &str,
    f: &crate::dto::TaskFields,
    now: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE tasks SET title = ?1, project_id = ?2, category_id = ?3, owner_id = ?4,
                          start_date = ?5, due_date = ?6, note = ?7, updated_at = ?8
         WHERE id = ?9",
        params![
            f.title,
            f.project_id,
            f.category_id,
            f.owner_id,
            f.start_date,
            f.due_date,
            f.note,
            now,
            id
        ],
    )?;
    Ok(())
}
pub fn list_project(conn: &Connection, project_id: &str) -> rusqlite::Result<Vec<TaskDto>> {
    let mut stmt = conn.prepare(
        "SELECT id FROM tasks
         WHERE project_id = ?1 AND deleted_at IS NULL AND canceled_at IS NULL
         ORDER BY due_date IS NULL, due_date, created_at",
    )?;
    let ids: Vec<String> = stmt
        .query_map([project_id], |r| r.get(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    ids.iter().map(|id| dto(conn, id)).collect()
}
