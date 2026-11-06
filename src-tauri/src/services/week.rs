use crate::dto::{CaptureFields, TaskDto, WeekStatsDto};
use crate::repo::{people, projects, settings, tasks};
use crate::services::local_today;
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
    capture_with_project(conn, raw, fields, None, now, id)
}

/// A capture whose `#project` token named a project that does not exist yet: the project
/// is created (or an existing one with the same name reused) in the same transaction as
/// the task, so a failed insert cannot leave an empty project behind.
pub fn capture_with_project(
    conn: &Connection,
    raw: &str,
    fields: &CaptureFields,
    new_project_name: Option<&str>,
    now: &str,
    id: &str,
) -> Result<TaskDto, String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let mut fields = fields.clone();
    if fields.project_id.is_none() {
        if let Some(name) = new_project_name.map(str::trim).filter(|name| !name.is_empty()) {
            let project_id = crate::services::projects::find_or_create(&tx, name, now)?;
            fields.project_id = Some(project_id);
        }
    }
    capture_rows(&tx, raw, &fields, now, id)?;
    tx.commit().map_err(|e| e.to_string())?;
    tasks::dto(conn, id).map_err(|e| e.to_string())
}

/// Validates a capture and inserts it, membership included. The caller owns the
/// transaction, so a template can add its subtasks to the same one.
pub(crate) fn capture_rows(
    conn: &Connection,
    raw: &str,
    fields: &CaptureFields,
    now: &str,
    id: &str,
) -> Result<(), String> {
    let title = raw.trim();
    if title.is_empty() {
        return Err("empty_title".into());
    }
    if let Some(priority) = fields.priority.as_deref() {
        if !crate::services::tasks::valid_priority(priority) {
            return Err("invalid_priority".into());
        }
    }
    if let Some(effort) = fields.effort_minutes {
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
    crate::services::projects::ensure_member(
        conn,
        fields.project_id.as_deref(),
        fields.owner_id.as_deref(),
        now,
    )?;
    // The finish is never taken from the caller: it always follows the estimate, so the
    // two stay consistent even when the estimate changes later.
    let today = crate::services::local_today(now)?;
    let anchor = crate::services::timing::anchor_for(today, None);
    let finish = crate::services::timing::finish_for(anchor, fields.effort_minutes.unwrap_or(480));
    let finish = finish.format("%Y-%m-%d").to_string();
    tasks::insert(conn, id, title, fields, &finish, now).map_err(|e| e.to_string())
}

pub fn list(conn: &Connection) -> Result<Vec<TaskDto>, String> {
    tasks::list_week(conn).map_err(|e| e.to_string())
}

/// The Monday of the week the page is showing. A weekend already shows the coming
/// week, so Saturday and Sunday count as that Monday: the numbers above the board and
/// the weekly pass must describe the days on screen, not the week that just ended.
pub fn week_start(today: &str) -> String {
    let date = NaiveDate::parse_from_str(today, "%Y-%m-%d")
        .unwrap_or_else(|_| chrono::Local::now().date_naive());
    let date = crate::services::timing::workday_on_or_after(date);
    let start = date - Duration::days(date.weekday().num_days_from_monday() as i64);
    start.format("%Y-%m-%d").to_string()
}

pub fn pass_queue(conn: &Connection) -> Result<Vec<TaskDto>, String> {
    tasks::list_for(
        conn,
        &format!(
            "SELECT id FROM tasks
             WHERE in_week = 1 AND status <> 'done' AND suspended = 0
               AND {}
             ORDER BY sort_order, id",
            tasks::VISIBLE_TASK_FILTER
        ),
        &[],
    )
    .map_err(|e| e.to_string())
}

pub fn resolve(
    conn: &Connection,
    task_id: &str,
    action: PassAction,
    suspend_until: Option<&str>,
    suspend_reason: Option<&str>,
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
            // A subtask finishing rolls its parent up; a plain task just closes.
            crate::services::tasks::set_status(conn, task_id, "done", now)?;
        }
        PassAction::Suspend => {
            return suspend(conn, task_id, suspend_until, suspend_reason, now);
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
    suspend_reason: Option<&str>,
    now: &str,
) -> Result<TaskDto, String> {
    // An empty field from the UI means "not set", same as leaving it out.
    let until = suspend_until.map(str::trim).filter(|value| !value.is_empty());
    let reason = suspend_reason.map(str::trim).filter(|value| !value.is_empty());
    let today = local_today(now)?;
    if let Some(until) = until {
        let until_date = NaiveDate::parse_from_str(until, "%Y-%m-%d")
            .map_err(|_| "invalid_suspend_date".to_string())?;
        if until_date < today {
            return Err("suspend_until_past".into());
        }
    }
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE tasks SET in_week = 0, suspended = 1, suspended_until = ?1,
                suspend_reason = ?2, suspended_at = ?3, updated_at = ?4
         WHERE id = ?5",
        params![
            until,
            reason,
            today.format("%Y-%m-%d").to_string(),
            now,
            task_id
        ],
    )
    .map_err(|e| e.to_string())?;
    // Parking an umbrella parks its work: otherwise the children stay on the week.
    tx.execute(
        "UPDATE tasks SET in_week = 0, suspended = 1, suspended_until = ?1,
                suspend_reason = ?2, suspended_at = ?3, updated_at = ?4
         WHERE parent_id = ?5 AND deleted_at IS NULL",
        params![
            until,
            reason,
            today.format("%Y-%m-%d").to_string(),
            now,
            task_id
        ],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    tasks::dto(conn, task_id).map_err(|e| e.to_string())
}

/// Stores the week the pass just cleared and hands it back, so the page shows the
/// same Monday the ledger kept.
pub fn mark_pass_done(conn: &Connection, today: &str) -> Result<String, String> {
    let start = week_start(today);
    settings::set(conn, "last_pass_week", &start).map_err(|e| e.to_string())?;
    Ok(start)
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
            "SELECT COUNT(*) FROM tasks WHERE deleted_at IS NULL AND status='done'
             AND actual_finish_at IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM tasks c
                             WHERE c.parent_id = tasks.id AND c.deleted_at IS NULL)
             AND date(actual_finish_at,'localtime') BETWEEN ?1 AND ?2",
        )?,
        delayed: count(
            "SELECT COUNT(*) FROM delays WHERE date(created_at,'localtime') BETWEEN ?1 AND ?2",
        )?,
    })
}


/// Tasks finished this week that already left the week list, so the page can still show
/// them on the day they were done.
pub fn list_done(conn: &Connection, today: &str) -> Result<Vec<TaskDto>, String> {
    let start = week_start(today);
    tasks::list_for(
        conn,
        &format!(
            "SELECT id FROM tasks
             WHERE status = 'done'
               AND ((actual_finish_at IS NOT NULL
                     AND date(actual_finish_at, 'localtime') BETWEEN ?1 AND ?2)
                    OR (expected_start_date BETWEEN ?1 AND ?2))
               AND {}
             ORDER BY actual_finish_at, sort_order, id",
            tasks::VISIBLE_TASK_FILTER
        ),
        &[&start, &today],
    )
    .map_err(|e| e.to_string())
}

pub fn list_suspended(conn: &Connection) -> Result<Vec<TaskDto>, String> {
    tasks::list_for(
        conn,
        &format!(
            "SELECT id FROM tasks
             WHERE suspended = 1 AND status <> 'done'
               AND {}
             ORDER BY suspended_until IS NULL, suspended_until, updated_at",
            tasks::VISIBLE_TASK_FILTER
        ),
        &[],
    )
    .map_err(|e| e.to_string())
}

pub fn resume(conn: &Connection, task_id: &str, now: &str) -> Result<TaskDto, String> {
    // start() already holds a transaction; it owns the commit in that case.
    if conn.is_autocommit() {
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        unpark(&tx, task_id, now)?;
        tx.commit().map_err(|e| e.to_string())?;
    } else {
        unpark(conn, task_id, now)?;
    }
    tasks::dto(conn, task_id).map_err(|e| e.to_string())
}

/// Brings a parked task and its subtasks back together.
fn unpark(conn: &Connection, task_id: &str, now: &str) -> Result<(), String> {
    conn.execute(
        &format!(
            "UPDATE tasks SET {}, updated_at = ?1,
                    sort_order = (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM tasks)
             WHERE id = ?2",
            tasks::UNPARK
        ),
        params![now, task_id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        &format!(
            "UPDATE tasks SET {}, updated_at = ?1 WHERE parent_id = ?2",
            tasks::UNPARK
        ),
        params![now, task_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Drops a task onto one day: it joins the week with that expected start, its finish
/// follows the estimate from there, and when it was parked it stops being suspended.
/// Order is a separate write, so a bad anchor cannot leave the date half-applied.
pub fn place(
    conn: &Connection,
    task_id: &str,
    day: &str,
    before_id: Option<&str>,
    now: &str,
) -> Result<(), String> {
    NaiveDate::parse_from_str(day, "%Y-%m-%d")
        .map_err(|_| "invalid_start_date".to_string())?;
    // One transaction: a bad anchor rolls the date back too, so a drop is all or nothing.
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let changed = tx
        .execute(
            &format!(
                "UPDATE tasks SET expected_start_date = ?1, {}, updated_at = ?2
                 WHERE id = ?3 AND canceled_at IS NULL AND archived_at IS NULL
                   AND deleted_at IS NULL AND status <> 'done'",
                tasks::UNPARK
            ),
            params![day, now, task_id],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("task_not_found".into());
    }
    let orders = crate::services::tasks::order_changes(&tx, task_id, before_id)?;
    crate::repo::tasks::write_orders_in(&tx, &orders).map_err(|e| e.to_string())?;
    // A drop moves the finish by the same rule a start edit uses, so dropping work on a
    // later day records the reschedule the delay ledger exists for. A rule owns its
    // occurrence's day, so those keep the date it was generated with.
    let (rule_id, effort): (Option<String>, i64) = tx
        .query_row(
            "SELECT rule_id, effort_minutes FROM tasks WHERE id = ?1",
            [task_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    if rule_id.is_none() {
        let anchor = crate::services::timing::anchor_for(local_today(now)?, Some(day));
        let finish = crate::services::timing::finish_for(anchor, effort);
        crate::services::timing::write_finish_in(&tx, task_id, finish, now)?;
    }
    crate::services::subtasks::sync_parent(&tx, task_id, now)?;
    tx.commit().map_err(|e| e.to_string())
}

pub fn start(conn: &Connection, task_id: &str, now: &str) -> Result<TaskDto, String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let suspended: i64 = tx
        .query_row("SELECT suspended FROM tasks WHERE id = ?1", [task_id], |r| {
            r.get(0)
        })
        .map_err(|e| e.to_string())?;
    if suspended == 1 {
        resume(&tx, task_id, now)?;
    }
    crate::services::tasks::set_status(&tx, task_id, "doing", now)?;
    tx.commit().map_err(|e| e.to_string())?;
    tasks::dto(conn, task_id).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use crate::db;
    use crate::dto::CaptureFields;
    use crate::services::week;
    use crate::services::week::PassAction;
    use rusqlite::Connection;

    const NOW: &str = "2026-10-20T08:00:00Z";

    fn local_date(now: &str) -> String {
        chrono::DateTime::parse_from_rfc3339(now)
            .unwrap()
            .with_timezone(&chrono::Local)
            .format("%Y-%m-%d")
            .to_string()
    }

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
        assert_eq!(t.effort_minutes, 480);
    }

    #[test]
    fn a_new_task_is_exclusive_by_default() {
        let c = db::open_in_memory().unwrap();
        let t = week::capture(&c, "交底", NOW, "t1").unwrap();
        assert!(t.exclusive);
    }

    #[test]
    fn capture_with_fields_saves_recognized_attributes() {
        let c = db::open_in_memory().unwrap();
        seed_known(&c);
        let fields = CaptureFields {
            project_id: Some("p1".into()),
            owner_id: Some("u1".into()),
            priority: Some("high".into()),
            effort_minutes: Some(150),
        };

        let t = week::capture_with_fields(&c, "  交底  ", &fields, NOW, "t1").unwrap();

        assert_eq!(t.title, "交底");
        assert_eq!(t.project_id.as_deref(), Some("p1"));
        assert_eq!(t.owner_id.as_deref(), Some("u1"));
        assert_eq!(t.priority, "high");
        assert_eq!(t.effort_minutes, 150);
        assert_eq!(
            t.expected_finish_date.as_deref(),
            Some(local_date(NOW).as_str()),
            "150 minutes still ends on the capture day"
        );
    }

    #[test]
    fn capture_adds_a_non_member_owner_to_the_project() {
        let c = db::open_in_memory().unwrap();
        let p = crate::services::projects::create(&c, "项目", NOW).unwrap();
        let outsider = crate::repo::people::create(&c, "u-outsider", "外人", NOW).unwrap();
        let fields = CaptureFields {
            project_id: Some(p.id.clone()),
            owner_id: Some(outsider.id.clone()),
            ..Default::default()
        };

        let t = week::capture_with_fields(&c, "交底", &fields, NOW, "t1").unwrap();

        assert_eq!(t.owner_id.as_deref(), Some(outsider.id.as_str()));
        assert!(
            crate::repo::projects::is_member(&c, &p.id, &outsider.id).unwrap(),
            "capturing with an outsider should add them to the project"
        );
    }

    #[test]
    fn capture_rolls_back_membership_when_inserting_the_task_fails() {
        let c = db::open_in_memory().unwrap();
        let p = crate::services::projects::create(&c, "项目", NOW).unwrap();
        let outsider = crate::repo::people::create(&c, "u-outsider", "外人", NOW).unwrap();
        c.execute_batch(
            "CREATE TRIGGER fail_capture BEFORE INSERT ON tasks
             WHEN NEW.id = 't1' BEGIN SELECT RAISE(ABORT, 'boom'); END;",
        )
        .unwrap();
        let fields = CaptureFields {
            project_id: Some(p.id.clone()),
            owner_id: Some(outsider.id.clone()),
            ..Default::default()
        };

        assert!(week::capture_with_fields(&c, "交底", &fields, NOW, "t1").is_err());
        assert!(
            !crate::repo::projects::is_member(&c, &p.id, &outsider.id).unwrap(),
            "the auto-added member must roll back with the failed insert"
        );
    }

    #[test]
    fn a_new_project_token_creates_the_project_and_joins_it() {
        let c = db::open_in_memory().unwrap();

        let t = week::capture_with_project(&c, "写方案", &CaptureFields::default(), Some(" 华东客户 "), NOW, "t1").unwrap();

        let project = crate::repo::projects::find_active_by_name(&c, "华东客户").unwrap();
        assert_eq!(t.project_id, project);
        let member_count: i64 = c
            .query_row(
                "SELECT COUNT(*) FROM project_members WHERE project_id = ?1",
                [project.unwrap()],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(member_count, 1, "the new project has me as its member");
    }

    #[test]
    fn an_existing_project_name_is_reused_instead_of_duplicated() {
        let c = db::open_in_memory().unwrap();
        let existing = crate::services::projects::create(&c, "华东客户", NOW).unwrap();

        let t = week::capture_with_project(&c, "写方案", &CaptureFields::default(), Some("华东客户"), NOW, "t1").unwrap();

        assert_eq!(t.project_id.as_deref(), Some(existing.id.as_str()));
        let count: i64 = c.query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn an_explicit_project_wins_over_the_new_name() {
        let c = db::open_in_memory().unwrap();
        seed_known(&c);
        let fields = CaptureFields {
            project_id: Some("p1".into()),
            ..Default::default()
        };

        let t = week::capture_with_project(&c, "写方案", &fields, Some("别的项目"), NOW, "t1").unwrap();

        assert_eq!(t.project_id.as_deref(), Some("p1"));
        assert!(crate::repo::projects::find_active_by_name(&c, "别的项目").unwrap().is_none());
    }

    #[test]
    fn a_failed_capture_does_not_leave_the_new_project_behind() {
        let c = db::open_in_memory().unwrap();
        c.execute_batch(
            "CREATE TRIGGER fail_capture BEFORE INSERT ON tasks
             WHEN NEW.id = 't1' BEGIN SELECT RAISE(ABORT, 'boom'); END;",
        )
        .unwrap();

        assert!(
            week::capture_with_project(&c, "写方案", &CaptureFields::default(), Some("华东客户"), NOW, "t1")
                .is_err()
        );
        assert!(crate::repo::projects::find_active_by_name(&c, "华东客户").unwrap().is_none());
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
                    effort_minutes: Some(0),
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
        let t = week::resolve(&c, "t1", PassAction::Keep, None, None, NOW).unwrap();
        assert_eq!(t.carry_count, 1);
        assert!(t.in_week);
    }

    #[test]
    fn suspend_without_a_date_or_reason_parks_the_task() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();

        let t = week::resolve(&c, "t1", PassAction::Suspend, None, None, NOW).unwrap();

        assert!(!t.in_week);
        assert!(t.suspended);
        assert!(t.suspended_until.is_none());
        assert_eq!(t.suspended_at.as_deref(), Some(local_date(NOW).as_str()));
        assert!(t.suspend_reason.is_none());
        assert_eq!(week::list_suspended(&c).unwrap().len(), 1);
        assert!(!week::list(&c).unwrap().iter().any(|row| row.id == "t1"));
        assert!(!week::pass_queue(&c).unwrap().iter().any(|row| row.id == "t1"));
    }

    #[test]
    fn suspend_keeps_the_reason_and_optional_date() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();

        let t = week::resolve(
            &c,
            "t1",
            PassAction::Suspend,
            Some("2026-11-02"),
            Some("  等甲方回数据  "),
            NOW,
        )
        .unwrap();

        assert!(t.suspended);
        assert_eq!(t.suspended_until.as_deref(), Some("2026-11-02"));
        assert_eq!(t.suspended_at.as_deref(), Some(local_date(NOW).as_str()));
        assert_eq!(t.suspend_reason.as_deref(), Some("等甲方回数据"));
    }

    #[test]
    fn suspend_treats_a_blank_reason_as_absent() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();

        let t = week::suspend(&c, "t1", None, Some("   "), NOW).unwrap();

        assert!(t.suspended);
        assert!(t.suspend_reason.is_none());
    }

    #[test]
    fn suspend_rejects_a_past_date() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        assert_eq!(
            week::resolve(&c, "t1", PassAction::Suspend, Some("2026-10-19"), None, NOW).unwrap_err(),
            "suspend_until_past"
        );
        assert!(week::list(&c).unwrap().iter().any(|t| t.id == "t1"));
    }

    #[test]
    fn suspend_rejects_an_invalid_date() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        assert_eq!(
            week::resolve(&c, "t1", PassAction::Suspend, Some("周五"), None, NOW).unwrap_err(),
            "invalid_suspend_date"
        );
    }

    #[test]
    fn suspend_moves_out_of_week() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        let t = week::resolve(&c, "t1", PassAction::Suspend, Some("2026-11-02"), None, NOW).unwrap();
        assert!(!t.in_week);
        assert!(t.suspended);
        assert_eq!(t.suspended_until.as_deref(), Some("2026-11-02"));
        assert!(t.suspend_reason.is_none());
    }

    #[test]
    fn cancel_sets_canceled_at_and_leaves_week() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "不再需要", NOW, "t1").unwrap();
        let t = week::resolve(&c, "t1", PassAction::Cancel, None, None, NOW).unwrap();
        assert!(t.canceled_at.is_some());
        assert!(!t.in_week);
    }

    #[test]
    fn done_leaves_week() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "做完了", NOW, "t1").unwrap();
        let t = week::resolve(&c, "t1", PassAction::Done, None, None, NOW).unwrap();
        assert_eq!(t.status, "done");
        assert!(!t.in_week);
    }

    #[test]
    fn pass_done_closes_a_subtask_and_rolls_up_its_parent() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        let parent = crate::services::subtasks::add(&c, "t1", "收集清单", NOW).unwrap();
        let child = parent.children[0].id.clone();

        let done = week::resolve(&c, &child, PassAction::Done, None, None, NOW).unwrap();
        assert_eq!(done.status, "done");

        // The umbrella follows its children and stays off the queue.
        let umbrella = crate::repo::tasks::dto(&c, "t1").unwrap();
        assert_eq!(umbrella.status, "done");
        assert!(!umbrella.in_week);
        assert!(week::pass_queue(&c).unwrap().is_empty());
    }

    #[test]
    fn parking_an_umbrella_parks_its_children() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交付", NOW, "t1").unwrap();
        let parent = crate::services::subtasks::add(&c, "t1", "收集", NOW).unwrap();
        let child = parent.children[0].id.clone();

        week::suspend(&c, "t1", Some("2026-11-02"), Some("等甲方"), NOW).unwrap();
        assert!(week::list(&c).unwrap().is_empty());
        // The work is parked with its umbrella, and only the work is listed.
        let parked: Vec<String> = week::list_suspended(&c)
            .unwrap()
            .into_iter()
            .map(|task| task.id)
            .collect();
        assert_eq!(parked, vec![child.clone()]);

        week::resume(&c, "t1", NOW).unwrap();
        let back: Vec<String> = week::list(&c)
            .unwrap()
            .into_iter()
            .map(|task| task.id)
            .collect();
        assert_eq!(back, vec![child]);
    }

    #[test]
    fn queue_lists_all_open_items() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "一", NOW, "t1").unwrap();
        week::capture(&c, "二", NOW, "t2").unwrap();
        week::resolve(&c, "t2", PassAction::Done, None, None, NOW).unwrap();
        let q = week::pass_queue(&c).unwrap();
        assert_eq!(q.len(), 1);
        assert_eq!(q[0].id, "t1");
    }

    #[test]
    fn stats_counts_added_done_and_delayed() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "一", NOW, "t1").unwrap();
        week::capture(&c, "二", NOW, "t2").unwrap();
        week::resolve(&c, "t1", PassAction::Done, None, None, NOW).unwrap();
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
            "UPDATE tasks SET status = 'done', in_week = 0, suspended = 1,
                    suspended_until = '2026-11-02'
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
        week::resolve(
            &c,
            "t1",
            PassAction::Suspend,
            Some("2026-11-02"),
            Some("等甲方"),
            NOW,
        )
        .unwrap();
        let suspended = week::list_suspended(&c).unwrap();
        assert_eq!(suspended.len(), 1);
        assert_eq!(suspended[0].suspend_reason.as_deref(), Some("等甲方"));
        let t = week::resume(&c, "t1", NOW).unwrap();
        assert!(t.in_week);
        assert!(!t.suspended);
        assert!(t.suspended_until.is_none());
        assert!(t.suspended_at.is_none());
        assert!(t.suspend_reason.is_none());
        assert!(week::list_suspended(&c).unwrap().is_empty());
    }

    #[test]
    fn resume_appends_to_the_end() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "一", NOW, "t1").unwrap();
        week::capture(&c, "二", NOW, "t2").unwrap();
        week::capture(&c, "三", NOW, "t3").unwrap();
        week::resolve(&c, "t1", PassAction::Suspend, Some("2026-11-02"), None, NOW).unwrap();

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
        assert!(!t.suspended);
        assert!(t.suspended_until.is_none());
    }

    #[test]
    fn start_stamps_the_actual_start_without_filling_in_a_plan() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();

        let t = week::start(&c, "t1", NOW).unwrap();

        assert_eq!(t.actual_start_at.as_deref(), Some(NOW));
        assert!(t.expected_start_date.is_none());
    }

    #[test]
    fn suspend_uses_the_local_calendar_day_across_utc_midnight() {
        // 2026-10-20 00:30 local (+08); the UTC date is still 2026-10-19.
        let now = "2026-10-19T16:30:00Z";
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", now, "t1").unwrap();

        let t = week::suspend(&c, "t1", None, None, now).unwrap();

        assert_eq!(t.suspended_at.as_deref(), Some("2026-10-20"));
    }

    #[test]
    fn start_rejects_an_invalid_now_before_writing() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();

        assert!(week::start(&c, "t1", "not-a-date").is_err());

        let t = crate::repo::tasks::dto(&c, "t1").unwrap();
        assert_eq!(t.status, "todo");
        assert!(t.actual_start_at.is_none());
    }

    #[test]
    fn start_keeps_a_plan_the_user_already_set() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        c.execute(
            "UPDATE tasks SET expected_start_date = '2026-10-01' WHERE id = 't1'",
            [],
        )
        .unwrap();

        let t = week::start(&c, "t1", NOW).unwrap();

        assert_eq!(t.expected_start_date.as_deref(), Some("2026-10-01"));
    }

    #[test]
    fn start_brings_a_suspended_task_back() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "一", NOW, "t1").unwrap();
        week::capture(&c, "二", NOW, "t2").unwrap();
        week::suspend(&c, "t1", Some("2026-11-02"), None, NOW).unwrap();

        let t = week::start(&c, "t1", NOW).unwrap();

        assert_eq!(t.status, "doing");
        assert!(t.in_week);
        assert!(!t.suspended);
        assert!(t.suspended_until.is_none());
        assert!(t.suspended_at.is_none());
        assert!(t.suspend_reason.is_none());
        assert_eq!(t.actual_start_at.as_deref(), Some(NOW));
        let ids: Vec<String> = week::list(&c).unwrap().into_iter().map(|t| t.id).collect();
        assert_eq!(ids, vec!["t2", "t1"]);
    }

    #[test]
    fn place_brings_a_suspended_task_back_on_the_dropped_day() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "一", NOW, "t1").unwrap();
        week::capture(&c, "二", NOW, "t2").unwrap();
        week::suspend(&c, "t1", Some("2026-11-02"), Some("等甲方"), NOW).unwrap();

        week::place(&c, "t1", "2026-10-22", Some("t2"), NOW).unwrap();

        let t = crate::repo::tasks::dto(&c, "t1").unwrap();
        assert!(t.in_week);
        assert!(!t.suspended);
        assert!(t.suspended_until.is_none());
        assert!(t.suspended_at.is_none());
        assert!(t.suspend_reason.is_none());
        assert_eq!(t.expected_start_date.as_deref(), Some("2026-10-22"));
        let ids: Vec<String> = week::list(&c).unwrap().into_iter().map(|t| t.id).collect();
        assert_eq!(ids, vec!["t1", "t2"]);
    }

    #[test]
    fn place_puts_a_task_at_the_end_without_an_anchor() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "一", NOW, "t1").unwrap();
        week::capture(&c, "二", NOW, "t2").unwrap();

        week::place(&c, "t1", "2026-10-21", None, NOW).unwrap();

        let ids: Vec<String> = week::list(&c).unwrap().into_iter().map(|t| t.id).collect();
        assert_eq!(ids, vec!["t2", "t1"]);
    }

    #[test]
    fn place_records_the_delay_it_causes() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();

        week::place(&c, "t1", "2026-10-22", None, NOW).unwrap();

        let t = crate::repo::tasks::dto(&c, "t1").unwrap();
        assert_eq!(t.expected_finish_date.as_deref(), Some("2026-10-22"));
        assert_eq!(t.delays.len(), 1, "a drop that pushes work back is a reschedule");
        assert_eq!(t.delays[0].kind, "reschedule");
        assert_eq!(t.delays[0].old_due.as_deref(), Some("2026-10-20"));
        assert_eq!(t.delays[0].new_due.as_deref(), Some("2026-10-22"));
    }

    #[test]
    fn place_on_a_past_day_still_starts_from_today() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();

        week::place(&c, "t1", "2026-10-19", None, NOW).unwrap();

        let t = crate::repo::tasks::dto(&c, "t1").unwrap();
        assert_eq!(t.expected_start_date.as_deref(), Some("2026-10-19"));
        // The rule a start edit uses: work begins today, never in the past.
        assert_eq!(t.expected_finish_date.as_deref(), Some("2026-10-20"));
        assert!(t.delays.is_empty(), "the finish did not move");
    }

    #[test]
    fn place_keeps_a_recurring_occurrence_on_its_rule_day() {
        use chrono::TimeZone;
        let c = db::open_in_memory().unwrap();
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
        let at = chrono::Local.with_ymd_and_hms(2026, 10, 20, 10, 0, 0).unwrap();
        crate::services::rules::materialize(&c, at).unwrap();
        let id: String = c
            .query_row("SELECT id FROM tasks WHERE rule_id = ?1", [&rule.id], |r| r.get(0))
            .unwrap();
        let before = crate::repo::tasks::dto(&c, &id).unwrap().expected_finish_date;

        week::place(&c, &id, "2026-10-22", None, NOW).unwrap();

        let t = crate::repo::tasks::dto(&c, &id).unwrap();
        assert_eq!(t.expected_finish_date, before, "a rule owns the occurrence day");
    }

    #[test]
    fn place_rejects_a_bad_day_or_a_missing_task() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();

        assert_eq!(
            week::place(&c, "t1", "周四", None, NOW).unwrap_err(),
            "invalid_start_date"
        );
        assert_eq!(
            week::place(&c, "nope", "2026-10-22", None, NOW).unwrap_err(),
            "task_not_found"
        );
        let t = crate::repo::tasks::dto(&c, "t1").unwrap();
        assert!(t.expected_start_date.is_none());
    }

    #[test]
    fn list_done_keeps_this_weeks_finishes_only() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "本周完成", NOW, "t1").unwrap();
        crate::services::tasks::set_status(&c, "t1", "done", NOW).unwrap();
        // Finished last week: the local day falls outside this week's Monday..today.
        week::capture(&c, "上周完成", NOW, "t2").unwrap();
        crate::services::tasks::set_status(&c, "t2", "done", "2026-10-12T00:00:00Z").unwrap();

        let done = week::list_done(&c, "2026-10-20").unwrap();
        let titles: Vec<&str> = done.iter().map(|t| t.title.as_str()).collect();
        assert_eq!(titles, vec!["本周完成"]);
    }

    #[test]
    fn list_done_leaves_the_open_week_alone() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "还没做", NOW, "t1").unwrap();
        assert!(week::list_done(&c, "2026-10-20").unwrap().is_empty());
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
    fn stats_count_done_by_actual_finish_not_updated_at() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "一", NOW, "t1").unwrap();
        c.execute(
            "UPDATE tasks SET status='done', updated_at='2026-09-01T00:00:00Z',
             actual_finish_at='2026-10-20T09:00:00Z' WHERE id='t1'",
            [],
        )
        .unwrap();
        assert_eq!(week::stats(&c, "2026-10-20").unwrap().done, 1);
    }

    #[test]
    fn week_start_is_monday_and_crosses_year() {
        assert_eq!(week::week_start("2026-10-20"), "2026-10-19");
        assert_eq!(week::week_start("2026-01-01"), "2025-12-29");
    }

    #[test]
    fn a_weekend_belongs_to_the_coming_week() {
        // Saturday and Sunday show next week's board, so they count as that week.
        assert_eq!(week::week_start("2026-10-23"), "2026-10-19");
        assert_eq!(week::week_start("2026-10-24"), "2026-10-26");
        assert_eq!(week::week_start("2026-10-25"), "2026-10-26");
        assert_eq!(week::week_start("2026-10-26"), "2026-10-26");
    }

    #[test]
    fn weekend_numbers_describe_the_week_the_page_shows() {
        let c = db::open_in_memory().unwrap();
        // Local Saturday midday: the page is already showing the coming week.
        week::capture(&c, "周六新增", "2026-10-24T04:00:00Z", "t1").unwrap();
        assert_eq!(week::stats(&c, "2026-10-24").unwrap().added, 0);

        crate::services::tasks::set_status(&c, "t1", "done", "2026-10-24T06:00:00Z").unwrap();
        assert_eq!(week::stats(&c, "2026-10-24").unwrap().done, 0);
        assert!(week::list_done(&c, "2026-10-24").unwrap().is_empty());
    }

    #[test]
    fn a_pass_finished_on_the_weekend_counts_for_the_coming_week() {
        let c = db::open_in_memory().unwrap();
        let start = week::mark_pass_done(&c, "2026-10-24").unwrap();
        assert_eq!(start, "2026-10-26");
        let stored = crate::repo::settings::get(&c, "last_pass_week").unwrap();
        assert_eq!(stored.as_deref(), Some(start.as_str()));
    }
}
