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

/// Drops fired reminders older than `cutoff`, which is shaped like `fired_at`: RFC3339 UTC.
pub fn prune_before(conn: &Connection, cutoff: &str) -> rusqlite::Result<usize> {
    conn.execute(
        "DELETE FROM notifications WHERE fired_at IS NOT NULL AND fired_at < ?1",
        [cutoff],
    )
}

pub fn mark_all_seen(conn: &Connection, now: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE notifications SET seen_at = ?1 WHERE seen_at IS NULL",
        [now],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::db;

    const NOW: &str = "2026-10-20T08:00:00Z";

    #[test]
    fn pruning_keeps_recent_fired_reminders() {
        let c = db::open_in_memory().unwrap();
        crate::services::week::capture(&c, "交底", NOW, "t1").unwrap();
        // One reminder per due date, so the two rows need different keys.
        for (id, due_key, fired) in [
            ("n-old", "2026-01-01", "2026-01-01T09:00:00Z"),
            ("n-new", "2026-10-19", "2026-10-19T09:00:00Z"),
        ] {
            c.execute(
                "INSERT INTO notifications (id, task_id, kind, due_key, scheduled_for, fired_at)
                 VALUES (?1, 't1', 'overdue', ?2, ?3, ?3)",
                rusqlite::params![id, due_key, fired],
            )
            .unwrap();
        }

        assert_eq!(super::prune_before(&c, "2026-07-01T00:00:00Z").unwrap(), 1);
        let left: String = c
            .query_row("SELECT id FROM notifications", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, "n-new");
    }
}
