use crate::dto::TaskDto;
use crate::repo::{delays, tasks};
use rusqlite::{params, Connection};
use uuid::Uuid;

pub fn set_due(
    conn: &Connection,
    task_id: &str,
    new_due: Option<&str>,
    reason: Option<&str>,
    now: &str,
) -> Result<TaskDto, String> {
    let old: Option<String> = conn
        .query_row("SELECT due_date FROM tasks WHERE id = ?1", [task_id], |r| {
            r.get(0)
        })
        .map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE tasks SET due_date = ?1, updated_at = ?2 WHERE id = ?3",
        params![new_due, now, task_id],
    )
    .map_err(|e| e.to_string())?;

    if let (Some(old_due), Some(due)) = (old.as_deref(), new_due) {
        if due > old_due {
            delays::insert(
                conn,
                &Uuid::new_v4().to_string(),
                task_id,
                "reschedule",
                Some(old_due),
                Some(due),
                reason,
                now,
            )
            .map_err(|e| e.to_string())?;
        }
    }

    tasks::dto(conn, task_id).map_err(|e| e.to_string())
}

pub fn add_note(conn: &Connection, task_id: &str, reason: &str, now: &str) -> Result<TaskDto, String> {
    let reason = reason.trim();
    if reason.is_empty() {
        return Err("empty_reason".into());
    }
    let due: Option<String> = conn
        .query_row("SELECT due_date FROM tasks WHERE id = ?1", [task_id], |r| {
            r.get(0)
        })
        .map_err(|e| e.to_string())?;
    delays::insert(
        conn,
        &Uuid::new_v4().to_string(),
        task_id,
        "overdue_note",
        due.as_deref(),
        due.as_deref(),
        Some(reason),
        now,
    )
    .map_err(|e| e.to_string())?;
    tasks::dto(conn, task_id).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use crate::db;
    use crate::services::{deliverables, week};

    const NOW: &str = "2026-10-20T08:00:00Z";

    fn with_due() -> rusqlite::Connection {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交付资料目录", NOW, "t1").unwrap();
        c.execute("UPDATE tasks SET due_date='2026-11-18' WHERE id='t1'", [])
            .unwrap();
        c
    }

    #[test]
    fn later_due_writes_reschedule_with_old_and_new() {
        let c = with_due();
        deliverables::set_due(&c, "t1", Some("2026-11-20"), Some("甲方追加数据"), NOW).unwrap();
        let ds = crate::repo::delays::list(&c, "t1").unwrap();
        assert_eq!(ds.len(), 1);
        assert_eq!(ds[0].kind, "reschedule");
        assert_eq!(ds[0].old_due.as_deref(), Some("2026-11-18"));
        assert_eq!(ds[0].new_due.as_deref(), Some("2026-11-20"));
        assert_eq!(ds[0].reason.as_deref(), Some("甲方追加数据"));
    }

    #[test]
    fn earlier_due_writes_nothing() {
        let c = with_due();
        deliverables::set_due(&c, "t1", Some("2026-11-10"), None, NOW).unwrap();
        assert!(crate::repo::delays::list(&c, "t1").unwrap().is_empty());
    }

    #[test]
    fn overdue_note_is_recorded() {
        let c = with_due();
        deliverables::add_note(&c, "t1", "等甲方回数据", NOW).unwrap();
        let ds = crate::repo::delays::list(&c, "t1").unwrap();
        assert_eq!(ds.len(), 1);
        assert_eq!(ds[0].kind, "overdue_note");
        assert_eq!(ds[0].reason.as_deref(), Some("等甲方回数据"));
    }
}
