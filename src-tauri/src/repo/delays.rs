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

/// Rewrites one record's reason; `None` clears it, because a blank reason is a real state.
pub fn set_reason(conn: &Connection, id: &str, reason: Option<&str>) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE delays SET reason = ?2 WHERE id = ?1",
        params![id, reason],
    )
}
