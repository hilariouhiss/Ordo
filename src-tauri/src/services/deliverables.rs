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
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or("task_not_found")?;
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

/// Moves a task's finish later and lets the estimate grow to cover the longer span; the
/// start stays where it is, so the week page draws the task from its start through the
/// new day. A weekend pick reads as the Friday before it, the last day the estimate
/// counts. The status, the start and the actual times are left alone, and the ledger
/// records why in the same transaction as the dates.
pub fn defer(
    conn: &Connection,
    task_id: &str,
    finish: &str,
    reason: &str,
    now: &str,
) -> Result<TaskDto, String> {
    let picked = chrono::NaiveDate::parse_from_str(finish.trim(), "%Y-%m-%d")
        .map_err(|_| "invalid_finish_date".to_string())?;
    let finish = crate::services::timing::workday_on_or_before(picked);
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let (old_finish, start, rule_owned): (Option<String>, Option<String>, bool) = tx
        .query_row(
            "SELECT expected_finish_date, expected_start_date, rule_id IS NOT NULL
             FROM tasks WHERE id = ?1 AND deleted_at IS NULL
               AND archived_at IS NULL AND canceled_at IS NULL",
            [task_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or("task_not_found")?;
    if rule_owned {
        return Err("rule_owns_finish".into());
    }
    if crate::services::subtasks::has_live_children(&tx, task_id).map_err(|e| e.to_string())? {
        return Err("parent_derived".into());
    }
    let Some(old) = old_finish else {
        // Every captured task has a finish; without one there is nothing to move later.
        return Err("task_not_found".into());
    };
    let new_finish = finish.format("%Y-%m-%d").to_string();
    if new_finish <= old {
        return Err("not_a_delay".into());
    }
    let today = crate::services::local_today(now)?;
    // The span the picked day implies runs from the task's own start, even a past one:
    // moving the finish by a day grows the estimate by that day. A start so far back that
    // the span would overflow the estimate falls back to the work left from today.
    let anchor = crate::services::timing::anchor_for(today, start.as_deref());
    let effort = match crate::services::timing::effort_for_finish(anchor, finish) {
        Ok(effort) => effort,
        Err(code) if code == "finish_too_far" => {
            crate::services::timing::effort_for_finish(today, finish)?
        }
        Err(code) => return Err(code),
    };
    tx.execute(
        "UPDATE tasks SET expected_finish_date = ?1, effort_minutes = ?2, updated_at = ?3
         WHERE id = ?4",
        rusqlite::params![new_finish, effort, now, task_id],
    )
    .map_err(|e| e.to_string())?;
    let reason = reason.trim();
    delays::insert(
        &tx,
        &Uuid::new_v4().to_string(),
        task_id,
        "reschedule",
        Some(old.as_str()),
        Some(new_finish.as_str()),
        if reason.is_empty() { None } else { Some(reason) },
        now,
    )
    .map_err(|e| e.to_string())?;
    // A child's new day is part of the parent's derived span.
    crate::services::subtasks::sync_parent(&tx, task_id, now)?;
    tx.commit().map_err(|e| e.to_string())?;
    tasks::dto(conn, task_id).map_err(|e| e.to_string())
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
    fn a_delay_moves_the_finish_and_records_the_reason() {
        let c = with_finish();
        let task =
            crate::services::deliverables::defer(&c, "t1", "2026-11-25", "等甲方回数据", NOW)
                .unwrap();

        assert_eq!(task.expected_finish_date.as_deref(), Some("2026-11-25"));
        // 2026-10-20 through 2026-11-25, workdays only: the estimate grows to the span.
        assert_eq!(task.effort_minutes, 27 * 480);
        let delay = task.delays.first().expect("the delay is in the ledger");
        assert_eq!(delay.kind, "reschedule");
        assert_eq!(delay.old_due.as_deref(), Some("2026-11-18"));
        assert_eq!(delay.new_due.as_deref(), Some("2026-11-25"));
        assert_eq!(delay.reason.as_deref(), Some("等甲方回数据"));
    }

    #[test]
    fn a_delay_keeps_the_start_and_refuses_anything_not_later() {
        let c = with_finish();
        c.execute(
            "UPDATE tasks SET expected_start_date='2026-10-21' WHERE id='t1'",
            [],
        )
        .unwrap();

        let task = crate::services::deliverables::defer(&c, "t1", "2026-11-25", "  ", NOW).unwrap();
        assert_eq!(task.expected_start_date.as_deref(), Some("2026-10-21"));
        assert!(task.delays[0].reason.is_none(), "a blank reason stays blank");

        assert_eq!(
            crate::services::deliverables::defer(&c, "t1", "2026-11-25", "再拖", NOW).unwrap_err(),
            "not_a_delay"
        );
        assert_eq!(
            crate::services::deliverables::defer(&c, "t1", "2026-11-20", "提前", NOW).unwrap_err(),
            "not_a_delay"
        );
    }

    #[test]
    fn a_delay_on_a_subtask_updates_the_parent_total() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "伞", NOW, "t1").unwrap();
        let parent = crate::services::subtasks::add(&c, "t1", "子任务", NOW).unwrap();
        let child_id = parent.children[0].id.clone();
        c.execute(
            "UPDATE tasks SET expected_finish_date = '2026-11-18' WHERE id = ?1",
            [&child_id],
        )
        .unwrap();

        let task = crate::services::deliverables::defer(&c, &child_id, "2026-11-25", "", NOW)
            .unwrap();
        assert_eq!(task.expected_finish_date.as_deref(), Some("2026-11-25"));
        let parent = crate::repo::tasks::dto(&c, "t1").unwrap();
        assert_eq!(
            parent.expected_finish_date.as_deref(),
            Some("2026-11-25"),
            "the parent follows its latest child"
        );
    }

    #[test]
    fn a_delay_spans_from_the_start_to_the_new_finish() {
        let c = with_finish();
        c.execute(
            "UPDATE tasks SET expected_start_date='2026-10-19',
                    expected_finish_date='2026-10-19' WHERE id='t1'",
            [],
        )
        .unwrap();

        let task = crate::services::deliverables::defer(&c, "t1", "2026-10-20", "", NOW).unwrap();

        // One day later, so the estimate covers both days and the week page draws the
        // task from 10/19 through 10/20.
        assert_eq!(task.expected_finish_date.as_deref(), Some("2026-10-20"));
        assert_eq!(task.effort_minutes, 2 * 480);
        assert_eq!(task.expected_start_date.as_deref(), Some("2026-10-19"));
    }

    #[test]
    fn a_delay_far_past_the_start_counts_the_whole_span() {
        let c = with_finish();
        c.execute(
            "UPDATE tasks SET expected_start_date='2026-10-01',
                    expected_finish_date='2026-10-19' WHERE id='t1'",
            [],
        )
        .unwrap();

        let task = crate::services::deliverables::defer(&c, "t1", "2026-10-21", "", NOW).unwrap();

        // Every workday from the start through the picked day, weekends skipped.
        assert_eq!(task.effort_minutes, 15 * 480);
        assert_eq!(task.expected_start_date.as_deref(), Some("2026-10-01"));
    }

    #[test]
    fn a_start_too_far_back_reads_the_days_left() {
        let c = with_finish();
        c.execute(
            "UPDATE tasks SET expected_start_date='2026-05-01',
                    expected_finish_date='2026-10-19' WHERE id='t1'",
            [],
        )
        .unwrap();

        // A start this far back would overflow the estimate; the days left from today
        // still let the task be deferred.
        let task = crate::services::deliverables::defer(&c, "t1", "2026-10-21", "", NOW).unwrap();
        assert_eq!(task.effort_minutes, 2 * 480);
        assert_eq!(task.expected_start_date.as_deref(), Some("2026-05-01"));
    }

    #[test]
    fn a_delay_reads_a_weekend_pick_as_the_friday_before() {
        let c = with_finish();
        let task = crate::services::deliverables::defer(&c, "t1", "2026-11-22", "", NOW).unwrap();
        assert_eq!(task.expected_finish_date.as_deref(), Some("2026-11-20"));
    }

    #[test]
    fn a_rule_owns_its_day_and_an_umbrella_its_dates() {
        let c = with_finish();
        let rule = crate::services::rules::save(
            &c,
            &crate::dto::RuleInput {
                title: "报销".into(),
                weekdays: vec![2],
                at: "09:00".into(),
                ..Default::default()
            },
            NOW,
        )
        .unwrap();
        c.execute("UPDATE tasks SET rule_id = ?1 WHERE id = 't1'", [&rule.id])
            .unwrap();
        assert_eq!(
            crate::services::deliverables::defer(&c, "t1", "2026-11-25", "", NOW).unwrap_err(),
            "rule_owns_finish"
        );

        let c = with_finish();
        week::capture(&c, "子任务", NOW, "kid").unwrap();
        c.execute("UPDATE tasks SET parent_id='t1' WHERE id='kid'", [])
            .unwrap();
        assert_eq!(
            crate::services::deliverables::defer(&c, "t1", "2026-11-25", "", NOW).unwrap_err(),
            "parent_derived"
        );
    }

    #[test]
    fn a_delay_on_a_missing_task_is_refused() {
        let c = db::open_in_memory().unwrap();
        assert_eq!(
            crate::services::deliverables::defer(&c, "gone", "2026-11-25", "", NOW).unwrap_err(),
            "task_not_found"
        );
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
    fn a_note_on_a_missing_task_is_refused() {
        let c = db::open_in_memory().unwrap();
        assert_eq!(
            crate::services::deliverables::add_note(&c, "gone", "等甲方", NOW).unwrap_err(),
            "task_not_found"
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
