use crate::repo::tasks::VISIBLE_TASK_FILTER;
use chrono::{DateTime, Datelike, Duration, Local, NaiveDate, TimeZone};
use rusqlite::Connection;

pub struct Candidate {
    pub task_id: String,
    pub kind: &'static str,
    pub due_key: String,
    pub scheduled_for: DateTime<Local>,
}

const CATCH_UP_DAYS: i64 = 14;

pub fn candidates(conn: &Connection, now: DateTime<Local>) -> Result<Vec<Candidate>, String> {
    let mut out = Vec::new();
    let today = now.date_naive();

    let sql = format!(
        "SELECT id, due_date FROM tasks
         WHERE due_date IS NOT NULL AND status <> 'done'
           AND {}",
        VISIBLE_TASK_FILTER
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;
    for row in rows {
        let (task_id, due) = row.map_err(|e| e.to_string())?;
        let Ok(due_date) = NaiveDate::parse_from_str(&due, "%Y-%m-%d") else {
            continue;
        };
        let advance = local_at(due_date - Duration::days(1), 17, 30)?;
        let overdue_at = local_at(due_date, 17, 30)?;

        if due_date >= today && advance <= now && recent(advance, now) {
            out.push(Candidate {
                task_id: task_id.clone(),
                kind: "due_tomorrow",
                due_key: due.clone(),
                scheduled_for: advance,
            });
        }
        if due_date < today && overdue_at <= now && recent(overdue_at, now) {
            out.push(Candidate {
                task_id,
                kind: "overdue",
                due_key: due,
                scheduled_for: overdue_at,
            });
        }
    }

    let sql = format!(
        "SELECT id, suspended_until FROM tasks
         WHERE suspended_until IS NOT NULL AND status <> 'done'
           AND {}",
        VISIBLE_TASK_FILTER
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;
    for row in rows {
        let (task_id, until) = row.map_err(|e| e.to_string())?;
        let Ok(date) = NaiveDate::parse_from_str(&until, "%Y-%m-%d") else {
            continue;
        };
        let scheduled = local_at(date, 9, 0)?;
        if scheduled <= now && recent(scheduled, now) {
            out.push(Candidate {
                task_id,
                kind: "suspend_start",
                due_key: until,
                scheduled_for: scheduled,
            });
        }
    }

    Ok(out)
}

fn local_at(date: NaiveDate, hour: u32, minute: u32) -> Result<DateTime<Local>, String> {
    Local
        .with_ymd_and_hms(date.year(), date.month(), date.day(), hour, minute, 0)
        .single()
        .ok_or_else(|| "invalid_local_time".into())
}

fn recent(scheduled: DateTime<Local>, now: DateTime<Local>) -> bool {
    scheduled >= now - Duration::days(CATCH_UP_DAYS)
}

#[cfg(test)]
mod tests {
    use chrono::{Local, TimeZone};
    use rusqlite::Connection;

    const NOW: &str = "2026-10-20T08:00:00Z";

    fn task_with_due(c: &Connection, id: &str, due: &str) {
        crate::services::week::capture(c, "交底", NOW, id).unwrap();
        c.execute(
            "UPDATE tasks SET due_date = ?1 WHERE id = ?2",
            rusqlite::params![due, id],
        )
        .unwrap();
    }

    fn at(y: i32, m: u32, d: u32, h: u32, min: u32) -> chrono::DateTime<Local> {
        Local.with_ymd_and_hms(y, m, d, h, min, 0).unwrap()
    }

    #[test]
    fn advance_reminder_fires_at_1730() {
        let c = crate::db::open_in_memory().unwrap();
        task_with_due(&c, "t1", "2026-10-21");
        let cands = crate::reminders::rules::candidates(&c, at(2026, 10, 20, 17, 31)).unwrap();
        assert_eq!(cands.len(), 1);
        assert_eq!(cands[0].kind, "due_tomorrow");
        assert_eq!(
            cands[0].scheduled_for.format("%Y-%m-%d %H:%M").to_string(),
            "2026-10-20 17:30"
        );
    }

    #[test]
    fn advance_reminder_not_early() {
        let c = crate::db::open_in_memory().unwrap();
        task_with_due(&c, "t1", "2026-10-21");
        assert!(
            crate::reminders::rules::candidates(&c, at(2026, 10, 20, 17, 29))
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn overdue_fires_once() {
        let c = crate::db::open_in_memory().unwrap();
        task_with_due(&c, "t1", "2026-10-17");
        let cands = crate::reminders::rules::candidates(&c, at(2026, 10, 20, 10, 0)).unwrap();
        let overdue = cands.iter().find(|x| x.kind == "overdue").unwrap();
        let first = crate::repo::notifications::fire(
            &c,
            "n1",
            &overdue.task_id,
            overdue.kind,
            &overdue.due_key,
            &overdue.scheduled_for.to_rfc3339(),
            NOW,
        )
        .unwrap();
        let second = crate::repo::notifications::fire(
            &c,
            "n2",
            &overdue.task_id,
            overdue.kind,
            &overdue.due_key,
            &overdue.scheduled_for.to_rfc3339(),
            NOW,
        )
        .unwrap();
        assert!(first);
        assert!(!second);
        let count: i64 = c
            .query_row("SELECT COUNT(*) FROM notifications", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn suspend_start_fires_at_0900() {
        let c = crate::db::open_in_memory().unwrap();
        crate::services::week::capture(&c, "交底", NOW, "t1").unwrap();
        c.execute(
            "UPDATE tasks SET in_week=0, suspended=1, suspended_until='2026-10-20'
             WHERE id='t1'",
            [],
        )
        .unwrap();
        let cands = crate::reminders::rules::candidates(&c, at(2026, 10, 20, 9, 1)).unwrap();
        assert_eq!(cands.len(), 1);
        assert_eq!(cands[0].kind, "suspend_start");
    }

    #[test]
    fn an_undated_suspension_has_no_reminder() {
        let c = crate::db::open_in_memory().unwrap();
        crate::services::week::capture(&c, "交底", NOW, "t1").unwrap();
        crate::services::week::suspend(&c, "t1", None, Some("等甲方"), NOW).unwrap();

        let cands = crate::reminders::rules::candidates(&c, at(2026, 10, 20, 9, 1)).unwrap();
        assert!(cands.iter().all(|c| c.kind != "suspend_start"));
    }

    #[test]
    fn catch_up_skips_older_than_14_days() {
        let c = crate::db::open_in_memory().unwrap();
        task_with_due(&c, "t1", "2026-09-30");
        assert!(
            crate::reminders::rules::candidates(&c, at(2026, 10, 20, 10, 0))
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn malformed_dates_are_skipped_not_fatal() {
        let c = crate::db::open_in_memory().unwrap();
        task_with_due(&c, "bad-due", "2026-10-21");
        c.execute("UPDATE tasks SET due_date = '周五' WHERE id = 'bad-due'", [])
            .unwrap();
        task_with_due(&c, "good-due", "2026-10-21");

        crate::services::week::capture(&c, "挂起坏的", NOW, "bad-suspend").unwrap();
        crate::services::week::capture(&c, "挂起好的", NOW, "good-suspend").unwrap();
        c.execute(
            "UPDATE tasks SET in_week=0, suspended=1, suspended_until='不是日期'
             WHERE id='bad-suspend'",
            [],
        )
        .unwrap();
        c.execute(
            "UPDATE tasks SET in_week=0, suspended=1, suspended_until='2026-10-20'
             WHERE id='good-suspend'",
            [],
        )
        .unwrap();

        let cands = crate::reminders::rules::candidates(&c, at(2026, 10, 20, 17, 31)).unwrap();
        assert!(
            cands
                .iter()
                .any(|c| c.task_id == "good-due" && c.kind == "due_tomorrow")
        );
        assert!(
            cands
                .iter()
                .any(|c| c.task_id == "good-suspend" && c.kind == "suspend_start")
        );
        assert!(cands.iter().all(|c| c.task_id != "bad-due"));
        assert!(cands.iter().all(|c| c.task_id != "bad-suspend"));
    }

    #[test]
    fn archived_project_tasks_do_not_remind() {
        let c = crate::db::open_in_memory().unwrap();
        let project = crate::services::projects::create(&c, "项目", NOW).unwrap();
        task_with_due(&c, "t1", "2026-10-21");
        c.execute(
            "UPDATE tasks SET project_id = ?1 WHERE id = 't1'",
            [&project.id],
        )
        .unwrap();
        crate::repo::projects::set_archived(&c, &project.id, true, NOW).unwrap();

        let cands = crate::reminders::rules::candidates(&c, at(2026, 10, 20, 17, 31)).unwrap();
        assert!(cands.iter().all(|c| c.task_id != "t1"));

        task_with_due(&c, "t2", "2026-10-21");
        let cands = crate::reminders::rules::candidates(&c, at(2026, 10, 20, 17, 31)).unwrap();
        assert!(
            cands
                .iter()
                .any(|c| c.task_id == "t2" && c.kind == "due_tomorrow")
        );
    }
}
