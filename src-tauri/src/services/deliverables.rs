use crate::dto::TaskDto;
use crate::repo::{delays, tasks};
use crate::services::local_today;
use rusqlite::{params, Connection};
use uuid::Uuid;

/// Moves the expected finish date. A later date writes the reschedule record, so the
/// finish date never travels through the generic patch.
pub fn set_expected_finish(
    conn: &Connection,
    task_id: &str,
    new_finish: Option<&str>,
    reason: Option<&str>,
    now: &str,
) -> Result<TaskDto, String> {
    if let Some(finish) = new_finish {
        chrono::NaiveDate::parse_from_str(finish, "%Y-%m-%d")
            .map_err(|_| "invalid_finish_date".to_string())?;
    }
    let today = local_today(now)?.format("%Y-%m-%d").to_string();
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let old: Option<String> = tx
        .query_row(
            "SELECT expected_finish_date FROM tasks WHERE id = ?1",
            [task_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    tx.execute(
        "UPDATE tasks SET expected_finish_date = ?1, updated_at = ?2 WHERE id = ?3",
        params![new_finish, now, task_id],
    )
    .map_err(|e| e.to_string())?;

    if let Some(finish) = new_finish {
        if crate::services::week::week_start(finish) == crate::services::week::week_start(&today) {
            // A task already in the week keeps its slot; a finish-date edit must not move it.
            tx.execute(
                &format!(
                    "UPDATE tasks SET {},
                            sort_order = CASE WHEN in_week = 1 THEN sort_order
                                              ELSE (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM tasks) END
                     WHERE id = ?1 AND canceled_at IS NULL AND archived_at IS NULL AND status <> 'done'",
                    crate::repo::tasks::UNPARK
                ),
                [task_id],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    if let (Some(old_finish), Some(finish)) = (old.as_deref(), new_finish) {
        if finish > old_finish {
            delays::insert(
                &tx,
                &Uuid::new_v4().to_string(),
                task_id,
                "reschedule",
                Some(old_finish),
                Some(finish),
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
        .query_row(
            "SELECT expected_finish_date FROM tasks WHERE id = ?1",
            [task_id],
            |r| r.get(0),
        )
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

    fn with_finish() -> rusqlite::Connection {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交付资料目录", NOW, "t1").unwrap();
        c.execute("UPDATE tasks SET expected_finish_date='2026-11-18' WHERE id='t1'", [])
            .unwrap();
        c
    }

    #[test]
    fn a_later_finish_writes_reschedule_with_old_and_new() {
        let c = with_finish();
        deliverables::set_expected_finish(&c, "t1", Some("2026-11-20"), Some("甲方追加数据"), NOW).unwrap();
        let ds = crate::repo::tasks::dto(&c, "t1").unwrap().delays;
        assert_eq!(ds.len(), 1);
        assert_eq!(ds[0].kind, "reschedule");
        assert_eq!(ds[0].old_due.as_deref(), Some("2026-11-18"));
        assert_eq!(ds[0].new_due.as_deref(), Some("2026-11-20"));
        assert_eq!(ds[0].reason.as_deref(), Some("甲方追加数据"));
    }

    #[test]
    fn invalid_finish_date_is_rejected_before_writing() {
        let c = with_finish();
        assert_eq!(
            deliverables::set_expected_finish(&c, "t1", Some("周五"), None, NOW).unwrap_err(),
            "invalid_finish_date"
        );
        let t = crate::repo::tasks::dto(&c, "t1").unwrap();
        assert_eq!(t.expected_finish_date.as_deref(), Some("2026-11-18"));
        assert!(t.delays.is_empty());
    }

    #[test]
    fn a_finish_in_the_current_week_enters_the_week_set() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        c.execute("UPDATE tasks SET in_week = 0 WHERE id='t1'", [])
            .unwrap();
        let t = deliverables::set_expected_finish(&c, "t1", Some("2026-10-21"), None, NOW).unwrap();
        assert!(t.in_week);
    }

    #[test]
    fn invalid_now_is_rejected_before_writing() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();

        assert!(
            deliverables::set_expected_finish(&c, "t1", Some("2026-10-21"), None, "not-a-date").is_err()
        );

        let t = crate::repo::tasks::dto(&c, "t1").unwrap();
        assert!(t.expected_finish_date.is_none());
    }

    #[test]
    fn a_finish_in_the_current_week_enters_the_week_at_the_end() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "一", NOW, "t1").unwrap();
        week::capture(&c, "二", NOW, "t2").unwrap();
        c.execute("UPDATE tasks SET in_week = 0 WHERE id = 't1'", [])
            .unwrap();

        deliverables::set_expected_finish(&c, "t1", Some("2026-10-21"), None, NOW).unwrap();

        let ids: Vec<String> = week::list(&c).unwrap().into_iter().map(|t| t.id).collect();
        assert_eq!(ids, vec!["t2", "t1"]);
    }

    #[test]
    fn a_finish_date_in_the_current_week_clears_a_suspension() {
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

        let t = deliverables::set_expected_finish(&c, "t1", Some("2026-10-21"), None, NOW).unwrap();

        assert!(t.in_week);
        assert!(!t.suspended);
        assert!(t.suspended_until.is_none());
        assert!(t.suspended_at.is_none());
        assert!(t.suspend_reason.is_none());
    }

    #[test]
    fn a_new_finish_date_keeps_an_in_week_task_in_its_slot() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "一", NOW, "t1").unwrap();
        week::capture(&c, "二", NOW, "t2").unwrap();
        week::capture(&c, "三", NOW, "t3").unwrap();

        deliverables::set_expected_finish(&c, "t1", Some("2026-10-21"), None, NOW).unwrap();

        let ids: Vec<String> = week::list(&c).unwrap().into_iter().map(|t| t.id).collect();
        assert_eq!(ids, vec!["t1", "t2", "t3"]);
    }

    #[test]
    fn an_earlier_finish_writes_nothing() {
        let c = with_finish();
        deliverables::set_expected_finish(&c, "t1", Some("2026-11-10"), None, NOW).unwrap();
        assert!(crate::repo::tasks::dto(&c, "t1").unwrap().delays.is_empty());
    }

    #[test]
    fn overdue_note_is_recorded() {
        let c = with_finish();
        deliverables::add_note(&c, "t1", "等甲方回数据", NOW).unwrap();
        let ds = crate::repo::tasks::dto(&c, "t1").unwrap().delays;
        assert_eq!(ds.len(), 1);
        assert_eq!(ds[0].kind, "overdue_note");
        assert_eq!(ds[0].reason.as_deref(), Some("等甲方回数据"));
    }
}