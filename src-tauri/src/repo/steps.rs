use crate::dto::StepDto;
use rusqlite::{params, Connection, OptionalExtension};

pub fn insert(
    conn: &Connection,
    id: &str,
    task_id: &str,
    title: &str,
    sort_order: i64,
    now: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO steps (id, task_id, title, sort_order, done, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 0, ?5, ?5)",
        params![id, task_id, title, sort_order, now],
    )?;
    Ok(())
}

pub fn next_sort(conn: &Connection, task_id: &str) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM steps WHERE task_id = ?1 AND deleted_at IS NULL",
        [task_id],
        |r| r.get(0),
    )
}

pub fn list(conn: &Connection, task_id: &str) -> rusqlite::Result<Vec<StepDto>> {
    let mut stmt = conn.prepare(
        "SELECT id, task_id, title, sort_order, done FROM steps
         WHERE task_id = ?1 AND deleted_at IS NULL ORDER BY sort_order",
    )?;
    let rows = stmt.query_map([task_id], |r| {
        Ok(StepDto {
            id: r.get(0)?,
            task_id: r.get(1)?,
            title: r.get(2)?,
            sort_order: r.get(3)?,
            done: r.get::<_, i64>(4)? == 1,
        })
    })?;
    rows.collect()
}

pub fn get(conn: &Connection, id: &str) -> rusqlite::Result<StepDto> {
    conn.query_row(
        "SELECT id, task_id, title, sort_order, done FROM steps
         WHERE id = ?1 AND deleted_at IS NULL",
        [id],
        |r| {
            Ok(StepDto {
                id: r.get(0)?,
                task_id: r.get(1)?,
                title: r.get(2)?,
                sort_order: r.get(3)?,
                done: r.get::<_, i64>(4)? == 1,
            })
        },
    )
}

/// The step a reopened task should continue from.
pub fn last_live(conn: &Connection, task_id: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT id FROM steps
         WHERE task_id = ?1 AND deleted_at IS NULL
         ORDER BY sort_order DESC
         LIMIT 1",
        [task_id],
        |r| r.get(0),
    )
    .optional()
}

pub fn set_done(conn: &Connection, id: &str, done: bool, now: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE steps SET done = ?1, updated_at = ?2 WHERE id = ?3",
        params![done as i64, now, id],
    )?;
    Ok(())
}

/// Ticks every live step, so the task's derived status agrees with the row.
pub fn complete_all(conn: &Connection, task_id: &str, now: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE steps SET done = 1, updated_at = ?1
         WHERE task_id = ?2 AND deleted_at IS NULL AND done = 0",
        params![now, task_id],
    )?;
    Ok(())
}

pub fn soft_delete(conn: &Connection, id: &str, now: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE steps SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2",
        params![now, id],
    )?;
    Ok(())
}
