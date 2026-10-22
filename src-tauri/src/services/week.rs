use crate::dto::{CaptureFields, TaskDto, WeekStatsDto};
use crate::repo::{people, projects, settings, tasks};
use chrono::{Datelike, Duration, NaiveDate};
use rusqlite::{params, Connection};
use serde::Deserialize;

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PassAction {
    Keep,
    Done,
    Suspend,
    Cancel,
}

pub fn capture(conn: &Connection, raw: &str, now: &str, id: &str) -> Result<TaskDto, String> {
    capture_with_fields(conn, raw, &CaptureFields::default(), now, id)
}

pub fn capture_with_fields(
    conn: &Connection,
    raw: &str,
    fields: &CaptureFields,
    now: &str,
    id: &str,
) -> Result<TaskDto, String> {
    let title = raw.trim();
    if title.is_empty() {
        return Err("empty_title".into());
    }
    if let Some(priority) = fields.priority.as_deref() {
        if !crate::services::tasks::valid_priority(priority) {
            return Err("invalid_priority".into());
        }
    }
    if let Some(due) = fields.due_date.as_deref() {
        if chrono::NaiveDate::parse_from_str(due, "%Y-%m-%d").is_err() {
            return Err("invalid_due_date".into());
        }
    }
    if let Some(effort) = fields.effort_days {
        if !crate::services::tasks::valid_effort(effort) {
            return Err("invalid_effort".into());
        }
    }
    if let Some(project_id) = fields.project_id.as_deref() {
        if !projects::exists(conn, project_id).map_err(|e| e.to_string())? {
            return Err("invalid_project".into());
        }
    }
    if let Some(owner_id) = fields.owner_id.as_deref() {
        if !people::exists(conn, owner_id).map_err(|e| e.to_string())? {
            return Err("invalid_owner".into());
        }
    }
    tasks::insert(conn, id, title, fields, now).map_err(|e| e.to_string())?;
    tasks::dto(conn, id).map_err(|e| e.to_string())
}

pub fn list(conn: &Connection) -> Result<Vec<TaskDto>, String> {
    tasks::list_week(conn).map_err(|e| e.to_string())
}

pub fn week_start(today: &str) -> String {
    let date = NaiveDate::parse_from_str(today, "%Y-%m-%d")
        .unwrap_or_else(|_| chrono::Local::now().date_naive());
    let start = date - Duration::days(date.weekday().num_days_from_monday() as i64);
    start.format("%Y-%m-%d").to_string()
}

pub fn pass_queue(conn: &Connection) -> Result<Vec<TaskDto>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id FROM tasks
             WHERE in_week = 1 AND status <> 'done' AND suspended_until IS NULL
               AND canceled_at IS NULL AND archived_at IS NULL AND deleted_at IS NULL
             ORDER BY sort_order, id",
        )
        .map_err(|e| e.to_string())?;
    let ids: Vec<String> = stmt
        .query_map([], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    ids.iter()
        .map(|id| tasks::dto(conn, id).map_err(|e| e.to_string()))
        .collect()
}

pub fn resolve(
    conn: &Connection,
    task_id: &str,
    action: PassAction,
    suspend_until: Option<&str>,
    now: &str,
) -> Result<TaskDto, String> {
    match action {
        PassAction::Keep => {
            conn.execute(
                "UPDATE tasks SET carry_count = carry_count + 1, updated_at = ?1 WHERE id = ?2",
                params![now, task_id],
            )
            .map_err(|e| e.to_string())?;
        }
        PassAction::Done => {
            tasks::set_status(conn, task_id, "done", true, now).map_err(|e| e.to_string())?;
        }
        PassAction::Suspend => {
            return suspend(conn, task_id, suspend_until, now);
        }
        PassAction::Cancel => {
            conn.execute(
                "UPDATE tasks SET canceled_at = ?1, in_week = 0, updated_at = ?1 WHERE id = ?2",
                params![now, task_id],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    tasks::dto(conn, task_id).map_err(|e| e.to_string())
}

pub fn suspend(
    conn: &Connection,
    task_id: &str,
    suspend_until: Option<&str>,
    now: &str,
) -> Result<TaskDto, String> {
    let until = suspend_until.ok_or("suspend_until_required")?;
    let today = chrono::DateTime::parse_from_rfc3339(now)
        .map(|d| d.with_timezone(&chrono::Local).date_naive())
        .map_err(|e| e.to_string())?;
    let until_date = NaiveDate::parse_from_str(until, "%Y-%m-%d")
        .map_err(|_| "invalid_suspend_date".to_string())?;
    if until_date < today {
        return Err("suspend_until_past".into());
    }
    conn.execute(
        "UPDATE tasks SET in_week = 0, suspended_until = ?1, updated_at = ?2 WHERE id = ?3",
        params![until, now, task_id],
    )
    .map_err(|e| e.to_string())?;
    tasks::dto(conn, task_id).map_err(|e| e.to_string())
}

pub fn mark_pass_done(conn: &Connection, today: &str) -> Result<(), String> {
    settings::set(conn, "last_pass_week", &week_start(today)).map_err(|e| e.to_string())
}

pub fn stats(conn: &Connection, today: &str) -> Result<WeekStatsDto, String> {
    let start = week_start(today);
    let count = |sql: &str| -> Result<i64, String> {
        conn.query_row(sql, rusqlite::params![&start, today], |r| r.get(0))
            .map_err(|e| e.to_string())
    };
    Ok(WeekStatsDto {
        added: count(
            "SELECT COUNT(*) FROM tasks WHERE deleted_at IS NULL
             AND date(created_at,'localtime') BETWEEN ?1 AND ?2",
        )?,
        done: count(
            "SELECT COUNT(*) FROM tasks WHERE deleted_at IS NULL AND status='done' AND done_at IS NOT NULL
             AND date(done_at,'localtime') BETWEEN ?1 AND ?2",
        )?,
        delayed: count(
            "SELECT COUNT(*) FROM delays WHERE date(created_at,'localtime') BETWEEN ?1 AND ?2",
        )?,
    })
}


pub fn list_suspended(conn: &Connection) -> Result<Vec<TaskDto>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id FROM tasks
             WHERE suspended_until IS NOT NULL AND status <> 'done'
               AND canceled_at IS NULL AND archived_at IS NULL AND deleted_at IS NULL
             ORDER BY suspended_until",
        )
        .map_err(|e| e.to_string())?;
    let ids: Vec<String> = stmt
        .query_map([], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    ids.iter()
        .map(|id| tasks::dto(conn, id).map_err(|e| e.to_string()))
        .collect()
}

pub fn resume(conn: &Connection, task_id: &str, now: &str) -> Result<TaskDto, String> {
    conn.execute(
        "UPDATE tasks SET in_week = 1, suspended_until = NULL, updated_at = ?1,
                sort_order = (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM tasks)
         WHERE id = ?2",
        params![now, task_id],
    )
    .map_err(|e| e.to_string())?;
    tasks::dto(conn, task_id).map_err(|e| e.to_string())
}

pub fn start(conn: &Connection, task_id: &str, now: &str) -> Result<TaskDto, String> {
    let suspended: Option<String> = conn
        .query_row(
            "SELECT suspended_until FROM tasks WHERE id = ?1",
            [task_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if suspended.is_some() {
        resume(conn, task_id, now)?;
    }
    crate::services::tasks::set_status(conn, task_id, "doing", now)
}

#[cfg(test)]
mod tests {
    use crate::db;
    use crate::dto::CaptureFields;
    use crate::services::week;
    use crate::services::week::PassAction;
    use rusqlite::Connection;

    const NOW: &str = "2026-10-20T08:00:00Z";

    fn seed_known(c: &Connection) {
        c.execute(
            "INSERT INTO projects (id, name, created_at, updated_at)
             VALUES ('p1', '华东客户交付', ?1, ?1)",
            [NOW],
        )
        .unwrap();
        c.execute(
            "INSERT INTO people (id, name, is_me, created_at, updated_at)
             VALUES ('u1', '老李', 0, ?1, ?1)",
            [NOW],
        )
        .unwrap();
    }

    #[test]
    fn capture_rejects_blank() {
        let c = db::open_in_memory().unwrap();
        assert_eq!(
            week::capture(&c, "   ", NOW, "t1").unwrap_err(),
            "empty_title"
        );
    }

    #[test]
    fn capture_keeps_original_and_enters_week() {
        let c = db::open_in_memory().unwrap();
        let long = "甲".repeat(2000);
        let t = week::capture(&c, &long, NOW, "t2").unwrap();
        assert_eq!(t.title.chars().count(), 2000);
        assert!(t.in_week);
        assert_eq!(t.carry_count, 0);
        let me: String = c
            .query_row("SELECT id FROM people WHERE is_me = 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(t.owner_id.as_deref(), Some(me.as_str()));
        assert_eq!(t.priority, "normal");
        assert_eq!(t.effort_days, 1.0);
    }

    #[test]
    fn capture_with_fields_saves_recognized_attributes() {
        let c = db::open_in_memory().unwrap();
        seed_known(&c);
        let fields = CaptureFields {
            project_id: Some("p1".into()),
            owner_id: Some("u1".into()),
            priority: Some("high".into()),
            due_date: Some("2026-11-20".into()),
            effort_days: Some(2.5),
        };

        let t = week::capture_with_fields(&c, "  交底  ", &fields, NOW, "t1").unwrap();

        assert_eq!(t.title, "交底");
        assert_eq!(t.project_id.as_deref(), Some("p1"));
        assert_eq!(t.owner_id.as_deref(), Some("u1"));
        assert_eq!(t.priority, "high");
        assert_eq!(t.due_date.as_deref(), Some("2026-11-20"));
        assert_eq!(t.effort_days, 2.5);
    }

    #[test]
    fn capture_with_fields_rejects_bad_values_before_inserting() {
        let c = db::open_in_memory().unwrap();
        seed_known(&c);

        for (fields, expected) in [
            (
                CaptureFields {
                    priority: Some("urgent".into()),
                    ..Default::default()
                },
                "invalid_priority",
            ),
            (
                CaptureFields {
                    due_date: Some("周五".into()),
                    ..Default::default()
                },
                "invalid_due_date",
            ),
            (
                CaptureFields {
                    effort_days: Some(0.25),
                    ..Default::default()
                },
                "invalid_effort",
            ),
            (
                CaptureFields {
                    project_id: Some("missing".into()),
                    ..Default::default()
                },
                "invalid_project",
            ),
            (
                CaptureFields {
                    owner_id: Some("missing".into()),
                    ..Default::default()
                },
                "invalid_owner",
            ),
        ] {
            assert_eq!(
                week::capture_with_fields(&c, "交底", &fields, NOW, "t1").unwrap_err(),
                expected
            );
        }

        let count: i64 = c
            .query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn week_follows_manual_order() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "一", NOW, "t1").unwrap();
        week::capture(&c, "二", NOW, "t2").unwrap();
        week::capture(&c, "三", NOW, "t3").unwrap();

        crate::services::tasks::move_task(&c, "t3", Some("t1")).unwrap();

        let ids: Vec<String> = week::list(&c).unwrap().into_iter().map(|t| t.id).collect();
        assert_eq!(ids, vec!["t3", "t1", "t2"]);
    }

    #[test]
    fn pass_queue_follows_manual_order() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "一", NOW, "t1").unwrap();
        week::capture(&c, "二", NOW, "t2").unwrap();

        crate::services::tasks::move_task(&c, "t2", Some("t1")).unwrap();

        let ids: Vec<String> = week::pass_queue(&c)
            .unwrap()
            .into_iter()
            .map(|t| t.id)
            .collect();
        assert_eq!(ids, vec!["t2", "t1"]);
    }

    #[test]
    fn keep_increments_carry_and_stays() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交付资料目录", NOW, "t1").unwrap();
        let t = week::resolve(&c, "t1", PassAction::Keep, None, NOW).unwrap();
        assert_eq!(t.carry_count, 1);
        assert!(t.in_week);
    }

    #[test]
    fn suspend_requires_date() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        assert_eq!(
            week::resolve(&c, "t1", PassAction::Suspend, None, NOW).unwrap_err(),
            "suspend_until_required"
        );
    }

    #[test]
    fn suspend_rejects_a_past_date() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        assert_eq!(
            week::resolve(&c, "t1", PassAction::Suspend, Some("2026-10-19"), NOW).unwrap_err(),
            "suspend_until_past"
        );
        assert!(week::list(&c).unwrap().iter().any(|t| t.id == "t1"));
    }

    #[test]
    fn suspend_rejects_an_invalid_date() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        assert_eq!(
            week::resolve(&c, "t1", PassAction::Suspend, Some("周五"), NOW).unwrap_err(),
            "invalid_suspend_date"
        );
    }

    #[test]
    fn suspend_moves_out_of_week() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        let t = week::resolve(&c, "t1", PassAction::Suspend, Some("2026-11-02"), NOW).unwrap();
        assert!(!t.in_week);
        assert_eq!(t.suspended_until.as_deref(), Some("2026-11-02"));
    }

    #[test]
    fn cancel_sets_canceled_at_and_leaves_week() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "不再需要", NOW, "t1").unwrap();
        let t = week::resolve(&c, "t1", PassAction::Cancel, None, NOW).unwrap();
        assert!(t.canceled_at.is_some());
        assert!(!t.in_week);
    }

    #[test]
    fn done_leaves_week() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "做完了", NOW, "t1").unwrap();
        let t = week::resolve(&c, "t1", PassAction::Done, None, NOW).unwrap();
        assert_eq!(t.status, "done");
        assert!(!t.in_week);
    }

    #[test]
    fn queue_lists_all_open_items() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "一", NOW, "t1").unwrap();
        week::capture(&c, "二", NOW, "t2").unwrap();
        week::resolve(&c, "t2", PassAction::Done, None, NOW).unwrap();
        let q = week::pass_queue(&c).unwrap();
        assert_eq!(q.len(), 1);
        assert_eq!(q[0].id, "t1");
    }

    #[test]
    fn stats_counts_added_done_and_delayed() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "一", NOW, "t1").unwrap();
        week::capture(&c, "二", NOW, "t2").unwrap();
        week::resolve(&c, "t1", PassAction::Done, None, NOW).unwrap();
        c.execute(
            "INSERT INTO delays (id, task_id, kind, old_due, new_due, created_at)
             VALUES ('d1','t2','reschedule','2026-10-01','2026-10-20','2026-10-20T09:00:00Z')",
            [],
        )
        .unwrap();
        let s = week::stats(&c, "2026-10-20").unwrap();
        assert_eq!(s.added, 2);
        assert_eq!(s.done, 1);
        assert_eq!(s.delayed, 1);
    }

    #[test]
    fn suspended_list_hides_completed_tasks() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        c.execute(
            "UPDATE tasks SET status = 'done', in_week = 0, suspended_until = '2026-11-02'
             WHERE id = 't1'",
            [],
        )
        .unwrap();

        assert!(week::list_suspended(&c).unwrap().is_empty());
    }

    #[test]
    fn suspended_list_and_resume() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        week::resolve(&c, "t1", PassAction::Suspend, Some("2026-11-02"), NOW).unwrap();
        assert_eq!(week::list_suspended(&c).unwrap().len(), 1);
        let t = week::resume(&c, "t1", NOW).unwrap();
        assert!(t.in_week);
        assert!(t.suspended_until.is_none());
        assert!(week::list_suspended(&c).unwrap().is_empty());
    }

    #[test]
    fn resume_appends_to_the_end() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "一", NOW, "t1").unwrap();
        week::capture(&c, "二", NOW, "t2").unwrap();
        week::capture(&c, "三", NOW, "t3").unwrap();
        week::resolve(&c, "t1", PassAction::Suspend, Some("2026-11-02"), NOW).unwrap();

        week::resume(&c, "t1", NOW).unwrap();

        let ids: Vec<String> = week::list(&c).unwrap().into_iter().map(|t| t.id).collect();
        assert_eq!(ids, vec!["t2", "t3", "t1"]);
    }

    #[test]
    fn start_marks_a_plain_task_doing() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();

        let t = week::start(&c, "t1", NOW).unwrap();

        assert_eq!(t.status, "doing");
        assert!(t.in_week);
        assert!(t.suspended_until.is_none());
    }

    #[test]
    fn start_brings_a_suspended_task_back() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "一", NOW, "t1").unwrap();
        week::capture(&c, "二", NOW, "t2").unwrap();
        week::suspend(&c, "t1", Some("2026-11-02"), NOW).unwrap();

        let t = week::start(&c, "t1", NOW).unwrap();

        assert_eq!(t.status, "doing");
        assert!(t.in_week);
        assert!(t.suspended_until.is_none());
        let ids: Vec<String> = week::list(&c).unwrap().into_iter().map(|t| t.id).collect();
        assert_eq!(ids, vec!["t2", "t1"]);
    }

    #[test]
    fn stats_count_monday_after_midnight_in_local_time() {
        let c = db::open_in_memory().unwrap();
        // 2026-10-19 is Monday; 00:30 +08 = 2026-10-18T16:30Z
        week::capture(&c, "一", "2026-10-18T16:30:00Z", "t1").unwrap();
        assert_eq!(week::stats(&c, "2026-10-19").unwrap().added, 1);
        assert_eq!(week::stats(&c, "2026-10-12").unwrap().added, 0);
    }

    #[test]
    fn stats_count_done_by_done_at_not_updated_at() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "一", NOW, "t1").unwrap();
        c.execute(
            "UPDATE tasks SET status='done', updated_at='2026-09-01T00:00:00Z',
             done_at='2026-10-20T09:00:00Z' WHERE id='t1'",
            [],
        )
        .unwrap();
        assert_eq!(week::stats(&c, "2026-10-20").unwrap().done, 1);
    }

    #[test]
    fn week_start_is_monday_and_crosses_year() {
        assert_eq!(week::week_start("2026-10-20"), "2026-10-19");
        assert_eq!(week::week_start("2026-10-25"), "2026-10-19");
        assert_eq!(week::week_start("2026-01-01"), "2025-12-29");
    }
}