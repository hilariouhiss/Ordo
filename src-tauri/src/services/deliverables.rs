use crate::dto::TaskDto;
use crate::repo::{delays, tasks};
use rusqlite::{Connection, OptionalExtension};
use uuid::Uuid;

/// Records why a task is late. The expected finish itself is derived from the estimate
/// and the start date, so there is no direct edit for it.
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

/// Rewrites the reason on a record already in the ledger; a blank reason clears it.
pub fn set_reason(conn: &Connection, delay_id: &str, reason: &str) -> Result<TaskDto, String> {
    let reason = reason.trim();
    let task_id: String = conn
        .query_row(
            "SELECT task_id FROM delays WHERE id = ?1",
            [delay_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or("delay_not_found")?;
    let value = if reason.is_empty() { None } else { Some(reason) };
    delays::set_reason(conn, delay_id, value).map_err(|e| e.to_string())?;
    tasks::dto(conn, &task_id).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use crate::db;
    use crate::services::week;

    const NOW: &str = "2026-10-20T08:00:00Z";

    fn with_finish() -> rusqlite::Connection {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交付资料目录", NOW, "t1").unwrap();
        c.execute("UPDATE tasks SET expected_finish_date='2026-11-18' WHERE id='t1'", [])
            .unwrap();
        c
    }

    #[test]
    fn overdue_note_is_recorded() {
        let c = with_finish();
        crate::services::deliverables::add_note(&c, "t1", "等甲方回数据", NOW).unwrap();
        let ds = crate::repo::tasks::dto(&c, "t1").unwrap().delays;
        assert_eq!(ds.len(), 1);
        assert_eq!(ds[0].kind, "overdue_note");
        assert_eq!(ds[0].reason.as_deref(), Some("等甲方回数据"));
    }

    #[test]
    fn a_reason_can_be_rewritten_and_cleared() {
        let c = with_finish();
        crate::services::deliverables::add_note(&c, "t1", "等甲方回数据", NOW).unwrap();
        let id = crate::repo::tasks::dto(&c, "t1").unwrap().delays[0].id.clone();

        let task = crate::services::deliverables::set_reason(&c, &id, "  需求临时改 ").unwrap();
        assert_eq!(task.delays[0].reason.as_deref(), Some("需求临时改"));

        let task = crate::services::deliverables::set_reason(&c, &id, "   ").unwrap();
        assert!(task.delays[0].reason.is_none(), "a blank reason clears the note");
    }

    #[test]
    fn an_unknown_record_is_rejected() {
        let c = with_finish();
        assert_eq!(
            crate::services::deliverables::set_reason(&c, "nope", "慢").unwrap_err(),
            "delay_not_found"
        );
    }

    #[test]
    fn an_empty_note_is_rejected() {
        let c = with_finish();
        assert_eq!(
            crate::services::deliverables::add_note(&c, "t1", "   ", NOW).unwrap_err(),
            "empty_reason"
        );
        assert!(crate::repo::tasks::dto(&c, "t1").unwrap().delays.is_empty());
    }
}
