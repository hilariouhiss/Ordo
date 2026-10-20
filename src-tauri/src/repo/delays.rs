use crate::dto::DelayDto;
use rusqlite::{params, Connection};

#[allow(clippy::too_many_arguments)]
pub fn insert(
    conn: &Connection,
    id: &str,
    task_id: &str,
    kind: &str,
    old_due: Option<&str>,
    new_due: Option<&str>,
    reason: Option<&str>,
    now: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO delays (id, task_id, kind, old_due, new_due, reason, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, task_id, kind, old_due, new_due, reason, now],
    )?;
    Ok(())
}

pub fn list(conn: &Connection, task_id: &str) -> rusqlite::Result<Vec<DelayDto>> {
    let mut stmt = conn.prepare(
        "SELECT id, task_id, kind, old_due, new_due, reason, created_at FROM delays
         WHERE task_id = ?1 ORDER BY created_at",
    )?;
    let rows = stmt.query_map([task_id], |r| {
        Ok(DelayDto {
            id: r.get(0)?,
            task_id: r.get(1)?,
            kind: r.get(2)?,
            old_due: r.get(3)?,
            new_due: r.get(4)?,
            reason: r.get(5)?,
            created_at: r.get(6)?,
        })
    })?;
    rows.collect()
}
