use rusqlite::{params, Connection};

/// One postponed reminder per task; snoozing again moves the same row.
pub fn set(conn: &Connection, task_id: &str, fire_at: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO reminder_snoozes (task_id, fire_at) VALUES (?1, ?2)
         ON CONFLICT(task_id) DO UPDATE SET fire_at = excluded.fire_at",
        params![task_id, fire_at],
    )?;
    Ok(())
}

/// Every pending snooze as (task id, RFC3339 UTC).
pub fn all(conn: &Connection) -> rusqlite::Result<Vec<(String, String)>> {
    let mut stmt = conn.prepare("SELECT task_id, fire_at FROM reminder_snoozes")?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
    rows.collect()
}

pub fn remove(conn: &Connection, task_id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM reminder_snoozes WHERE task_id = ?1", [task_id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::db;

    #[test]
    fn a_task_keeps_one_snooze() {
        let c = db::open_in_memory().unwrap();
        crate::services::week::capture(&c, "交底", "2026-10-20T08:00:00Z", "t1").unwrap();

        super::set(&c, "t1", "2026-10-20T09:00:00Z").unwrap();
        super::set(&c, "t1", "2026-10-21T01:00:00Z").unwrap();
        assert_eq!(
            super::all(&c).unwrap(),
            [("t1".to_string(), "2026-10-21T01:00:00Z".to_string())]
        );

        super::remove(&c, "t1").unwrap();
        assert!(super::all(&c).unwrap().is_empty());
    }
}
