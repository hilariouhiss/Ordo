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
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let old: Option<String> = tx
        .query_row("SELECT due_date FROM tasks WHERE id = ?1", [task_id], |r| {
            r.get(0)
        })
        .map_err(|e| e.to_string())?;

    tx.execute(
        "UPDATE tasks SET due_date = ?1, updated_at = ?2 WHERE id = ?3",
        params![new_due, now, task_id],
    )
    .map_err(|e| e.to_string())?;

    if let Some(due) = new_due {
        let today = chrono::DateTime::parse_from_rfc3339(now)
            .map(|d| d.with_timezone(&chrono::Local).format("%Y-%m-%d").to_string())
            .unwrap_or_default();
        if !today.is_empty()
            && crate::services::week::week_start(due) == crate::services::week::week_start(&today)
        {
            // A task already in the week keeps its slot; a due-date edit must not move it.
            tx.execute(
                "UPDATE tasks SET in_week = 1, suspended = 0, suspended_until = NULL,
                        suspended_at = NULL, suspend_reason = NULL,
                        sort_order = CASE WHEN in_week = 1 THEN sort_order
                                          ELSE (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM tasks) END
                 WHERE id = ?1 AND canceled_at IS NULL AND archived_at IS NULL AND status <> 'done'",
                [task_id],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    if let (Some(old_due), Some(due)) = (old.as_deref(), new_due) {
        if due > old_due {
            delays::insert(
                &tx,
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

    tx.commit().map_err(|e| e.to_string())?;
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
        let ds = crate::repo::tasks::dto(&c, "t1").unwrap().delays;
        assert_eq!(ds.len(), 1);
        assert_eq!(ds[0].kind, "reschedule");
        assert_eq!(ds[0].old_due.as_deref(), Some("2026-11-18"));
        assert_eq!(ds[0].new_due.as_deref(), Some("2026-11-20"));
        assert_eq!(ds[0].reason.as_deref(), Some("甲方追加数据"));
    }

    #[test]
    fn due_in_current_week_enters_the_week_set() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        c.execute("UPDATE tasks SET in_week = 0 WHERE id='t1'", [])
            .unwrap();
        let t = deliverables::set_due(&c, "t1", Some("2026-10-21"), None, NOW).unwrap();
        assert!(t.in_week);
    }

    #[test]
    fn due_in_current_week_enters_the_week_at_the_end() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "一", NOW, "t1").unwrap();
        week::capture(&c, "二", NOW, "t2").unwrap();
        c.execute("UPDATE tasks SET in_week = 0 WHERE id = 't1'", [])
            .unwrap();

        deliverables::set_due(&c, "t1", Some("2026-10-21"), None, NOW).unwrap();

        let ids: Vec<String> = week::list(&c).unwrap().into_iter().map(|t| t.id).collect();
        assert_eq!(ids, vec!["t2", "t1"]);
    }

    #[test]
    fn a_due_date_in_the_current_week_clears_a_suspension() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        week::resolve(
            &c,
            "t1",
            crate::services::week::PassAction::Suspend,
            None,
            Some("等甲方"),
            NOW,
        )
        .unwrap();

        let t = deliverables::set_due(&c, "t1", Some("2026-10-21"), None, NOW).unwrap();

        assert!(t.in_week);
        assert!(!t.suspended);
        assert!(t.suspended_until.is_none());
        assert!(t.suspended_at.is_none());
        assert!(t.suspend_reason.is_none());
    }

    #[test]
    fn a_new_due_date_keeps_an_in_week_task_in_its_slot() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "一", NOW, "t1").unwrap();
        week::capture(&c, "二", NOW, "t2").unwrap();
        week::capture(&c, "三", NOW, "t3").unwrap();

        deliverables::set_due(&c, "t1", Some("2026-10-21"), None, NOW).unwrap();

        let ids: Vec<String> = week::list(&c).unwrap().into_iter().map(|t| t.id).collect();
        assert_eq!(ids, vec!["t1", "t2", "t3"]);
    }

    #[test]
    fn earlier_due_writes_nothing() {
        let c = with_due();
        deliverables::set_due(&c, "t1", Some("2026-11-10"), None, NOW).unwrap();
        assert!(crate::repo::tasks::dto(&c, "t1").unwrap().delays.is_empty());
    }

    #[test]
    fn overdue_note_is_recorded() {
        let c = with_due();
        deliverables::add_note(&c, "t1", "等甲方回数据", NOW).unwrap();
        let ds = crate::repo::tasks::dto(&c, "t1").unwrap().delays;
        assert_eq!(ds.len(), 1);
        assert_eq!(ds[0].kind, "overdue_note");
        assert_eq!(ds[0].reason.as_deref(), Some("等甲方回数据"));
    }
}