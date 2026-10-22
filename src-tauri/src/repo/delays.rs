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

