use rusqlite::{params, Connection};

#[allow(clippy::too_many_arguments)]
pub fn fire(
    conn: &Connection,
    id: &str,
    task_id: &str,
    kind: &str,
    due_key: &str,
    scheduled_for: &str,
    now: &str,
) -> rusqlite::Result<bool> {
    let changed = conn.execute(
        "INSERT OR IGNORE INTO notifications (id, task_id, kind, due_key, scheduled_for, fired_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, task_id, kind, due_key, scheduled_for, now],
    )?;
    Ok(changed > 0)
}

pub fn unread_count(conn: &Connection) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM notifications WHERE fired_at IS NOT NULL AND seen_at IS NULL",
        [],
        |r| r.get(0),
    )
}

pub fn mark_all_seen(conn: &Connection, now: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE notifications SET seen_at = ?1 WHERE seen_at IS NULL",
        [now],
    )?;
    Ok(())
}
