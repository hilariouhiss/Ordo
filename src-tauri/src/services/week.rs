use crate::dto::{CaptureFields, TaskDto, WeekStatsDto};
use crate::repo::{people, projects, settings, tasks};
use crate::services::local_today;
use chrono::{Datelike, Duration, NaiveDate};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PassAction {
    Keep,
    Done,
    Park,
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
    capture_with_project(conn, raw, fields, None, false, now, id)
}

/// A capture whose `#project` token named a project that does not exist yet: the project
/// is created (or an existing one with the same name reused) in the same transaction as
/// the task, so a failed insert cannot leave an empty project behind. `done` records a
/// line that already happened: the row lands complete in that same transaction.
pub fn capture_with_project(
    conn: &Connection,
    raw: &str,
    fields: &CaptureFields,
    new_project_name: Option<&str>,
    done: bool,
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
    capture_rows(&tx, raw, &fields, None, now, id)?;
    // The detailed attributes ride on the same insert: one statement, one transaction.
    let mut extra = crate::dto::TaskPatch::default();
    extra.category_id = fields.category_id.clone().map(Some);
    extra.note = fields.note.clone().map(Some);
    extra.exclusive = fields.exclusive;
    if !fields.tags.is_empty() {
        extra.tags = Some(fields.tags.clone());
    }
    if done || fields.actual_start_date.is_some() {
        let today = crate::services::local_today(now)?;
        let day = fields
            .actual_start_date
            .clone()
            .unwrap_or_else(|| today.format("%Y-%m-%d").to_string());
        // A finished line is measured from local 09:00 to its effort, so the pair is
        // minute-precise; a started line only records when the work began.
        extra.actual_start_at = Some(Some(crate::services::timing::morning_stamp(&day)?));
        if done {
            let effort = fields
                .actual_effort_minutes
                .or(fields.effort_minutes)
                .unwrap_or(crate::services::timing::MINUTES_PER_DAY);
            extra.actual_effort_minutes = Some(Some(effort));
        }
    }
    crate::repo::tasks::apply_patch_in(&tx, id, &extra, now).map_err(|e| e.to_string())?;
    // A pair sync marks a finished line done and moves a started one into doing.
    crate::services::tasks::sync_actual_in(&tx, id, &extra, now)?;
    tx.commit().map_err(|e| e.to_string())?;
    tasks::dto(conn, id).map_err(|e| e.to_string())
}

/// Validates a capture and inserts it, membership included. The caller owns the
/// transaction, so a template can add its subtasks to the same one.
pub(crate) fn capture_rows(
    conn: &Connection,
    raw: &str,
    fields: &CaptureFields,
    scope_override: Option<&str>,
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
    if let Some(category_id) = fields.category_id.as_deref() {
        if !crate::repo::categories::exists(conn, category_id).map_err(|e| e.to_string())? {
            return Err("invalid_category".into());
        }
    }
    if let Some(day) = fields.expected_start_date.as_deref() {
        chrono::NaiveDate::parse_from_str(day, "%Y-%m-%d")
            .map_err(|_| "invalid_start_date".to_string())?;
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
    let anchor = crate::services::timing::anchor_for(today, fields.expected_start_date.as_deref());
    let finish = crate::services::timing::finish_for(anchor, fields.effort_minutes.unwrap_or(480));
    let finish = finish.format("%Y-%m-%d").to_string();
    // A project owns its world; a loose task stays in the mode it was written in.
    let scope = match fields.project_id.as_deref() {
        Some(project_id) => projects::scope_of(conn, project_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "invalid_project".to_string())?,
        None => match scope_override {
            Some(scope) => scope.to_string(),
            None => settings::mode(conn).map_err(|e| e.to_string())?,
        },
    };
    tasks::insert(conn, id, title, fields, &scope, &finish, now).map_err(|e| e.to_string())
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
    let mode = crate::repo::settings::mode(conn).map_err(|e| e.to_string())?;
    tasks::list_for(
        conn,
        &format!(
            "SELECT id FROM tasks
             WHERE in_week = 1 AND status <> 'done' AND parked = 0
               AND {} AND {}
             ORDER BY sort_order, id",
            tasks::visible_task_filter("tasks"),
            crate::repo::scope_eq("tasks", &mode)
        ),
        &[],
    )
    .map_err(|e| e.to_string())
}

pub fn resolve(
    conn: &Connection,
    task_id: &str,
    action: PassAction,
    park_until: Option<&str>,
    park_reason: Option<&str>,
    parked_on_id: Option<&str>,
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
        PassAction::Park => {
            return park(conn, task_id, park_until, park_reason, parked_on_id, now);
        }
        PassAction::Cancel => {
            conn.execute(
                "UPDATE tasks SET canceled_at = ?1, in_week = 0, updated_at = ?1 WHERE id = ?2",
                params![now, task_id],
            )
            .map_err(|e| e.to_string())?;
            // A canceled subtask stops being work, so the umbrella totals what is left.
            crate::services::subtasks::sync_parent(conn, task_id, now)?;
        }
    }
    tasks::dto(conn, task_id).map_err(|e| e.to_string())
}

/// Sets a task aside: it leaves the week, keeps why and when to look again, and keeps
/// the person whose reply it waits on. Open children are set aside with it, because it is
/// the whole thing that is with someone else.
pub fn park(
    conn: &Connection,
    task_id: &str,
    park_until: Option<&str>,
    park_reason: Option<&str>,
    parked_on_id: Option<&str>,
    now: &str,
) -> Result<TaskDto, String> {
    // An empty field from the UI means "not set", same as leaving it out.
    let until = park_until.map(str::trim).filter(|value| !value.is_empty());
    let reason = park_reason.map(str::trim).filter(|value| !value.is_empty());
    let on = parked_on_id.map(str::trim).filter(|value| !value.is_empty());
    let today = local_today(now)?;
    if let Some(until) = until {
        let until_date = NaiveDate::parse_from_str(until, "%Y-%m-%d")
            .map_err(|_| "invalid_park_date".to_string())?;
        if until_date < today {
            return Err("park_until_past".into());
        }
    }
    let status: String = conn
        .query_row("SELECT status FROM tasks WHERE id = ?1", [task_id], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or("task_not_found")?;
    // A finished task cannot be set aside: completion is the terminal state.
    if status == "done" {
        return Err("task_done".into());
    }
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let parked_on = today.format("%Y-%m-%d").to_string();
    let park = tasks::Park::Parked {
        until,
        reason,
        on,
        at: Some(&parked_on),
    };
    tasks::write_park_in(&tx, task_id, park, now, false).map_err(|e| e.to_string())?;
    // Parking an umbrella parks its work: otherwise the children stay on the week.
    tasks::write_park_in(&tx, task_id, park, now, true).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    tasks::dto(conn, task_id).map_err(|e| e.to_string())
}

/// Stores the week the pass just cleared and hands it back, so the page shows the
/// same Monday the ledger kept.
pub fn mark_pass_done(conn: &Connection, today: &str) -> Result<String, String> {
    let start = week_start(today);
    let key = if crate::repo::settings::mode(conn).map_err(|e| e.to_string())?
        == settings::MODE_PERSONAL
    {
        settings::keys::LAST_PASS_WEEK_PERSONAL
    } else {
        settings::keys::LAST_PASS_WEEK
    };
    settings::set(conn, key, &start).map_err(|e| e.to_string())?;
    Ok(start)
}

pub fn stats(conn: &Connection, today: &str) -> Result<WeekStatsDto, String> {
    let start = week_start(today);
    let mode = crate::repo::settings::mode(conn).map_err(|e| e.to_string())?;
    let scope = crate::repo::scope_eq("tasks", &mode);
    let count = |sql: &str| -> Result<i64, String> {
        conn.query_row(sql, rusqlite::params![&start, today], |r| r.get(0))
            .map_err(|e| e.to_string())
    };
    Ok(WeekStatsDto {
        added: count(&format!(
            "SELECT COUNT(*) FROM tasks WHERE deleted_at IS NULL AND {scope}
             AND date(created_at,'localtime') BETWEEN ?1 AND ?2"
        ))?,
        // The same filter the finished cards below use, so the number and the list agree.
        done: count(&format!(
            "SELECT COUNT(*) FROM tasks WHERE status='done'
             AND actual_finish_at IS NOT NULL AND {} AND {scope}
             AND date(actual_finish_at,'localtime') BETWEEN ?1 AND ?2",
            tasks::done_week_filter("tasks")
        ))?,
        delayed: count(&format!(
            "SELECT COUNT(*) FROM delays d JOIN tasks t ON t.id = d.task_id
             WHERE date(d.created_at,'localtime') BETWEEN ?1 AND ?2 AND {}",
            crate::repo::scope_eq("t", &mode)
        ))?,
    })
}


/// Tasks finished this week that already left the week list, so the page can still show
/// them on the day they were done.
pub fn list_done(conn: &Connection, today: &str) -> Result<Vec<TaskDto>, String> {
    let start = week_start(today);
    let mode = crate::repo::settings::mode(conn).map_err(|e| e.to_string())?;
    tasks::list_for(
        conn,
        &format!(
            "SELECT id FROM tasks
             WHERE status = 'done'
               AND ((actual_finish_at IS NOT NULL
                     AND date(actual_finish_at, 'localtime') BETWEEN ?1 AND ?2)
                    OR (expected_start_date BETWEEN ?1 AND ?2))
               AND {} AND {}
             ORDER BY actual_finish_at, sort_order, id",
            tasks::done_week_filter("tasks"),
            crate::repo::scope_eq("tasks", &mode)
        ),
        &[&start, &today],
    )
    .map_err(|e| e.to_string())
}

/// Every task set aside: the week page puts each on the day its plan would have started.
pub fn list_parked(conn: &Connection) -> Result<Vec<TaskDto>, String> {
    let mode = crate::repo::settings::mode(conn).map_err(|e| e.to_string())?;
    tasks::list_for(
        conn,
        &format!(
            "SELECT id FROM tasks
             WHERE parked = 1 AND status <> 'done'
               AND {} AND {}
             ORDER BY park_until IS NULL, park_until, updated_at",
            tasks::visible_task_filter("tasks"),
            crate::repo::scope_eq("tasks", &mode)
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
    tasks::write_park_in(conn, task_id, tasks::Park::InWeek, now, false)
        .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE tasks SET sort_order = (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM tasks),
                updated_at = ?1
         WHERE id = ?2",
        params![now, task_id],
    )
    .map_err(|e| e.to_string())?;
    tasks::write_park_in(conn, task_id, tasks::Park::InWeek, now, true)
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Drops a task onto one day: it joins the week with that expected start, its finish
/// follows the estimate from there, and when it was parked the drop brings it back.
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
    let (rule_id, effort): (Option<String>, i64) = tx
        .query_row(
            "SELECT rule_id, effort_minutes FROM tasks
             WHERE id = ?1 AND canceled_at IS NULL AND archived_at IS NULL
               AND deleted_at IS NULL AND status <> 'done'",
            [task_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or("task_not_found")?;
    // The rule owns the day, and moving only the start would put it after the finish.
    if rule_id.is_some() {
        return Err("rule_owns_finish".into());
    }
    tx.execute(
        "UPDATE tasks SET expected_start_date = ?1, updated_at = ?2 WHERE id = ?3",
        params![day, now, task_id],
    )
    .map_err(|e| e.to_string())?;
    tasks::write_park_in(&tx, task_id, tasks::Park::InWeek, now, false)
        .map_err(|e| e.to_string())?;
    let orders = crate::services::tasks::order_changes(&tx, task_id, before_id)?;
    crate::repo::tasks::write_orders_in(&tx, &orders).map_err(|e| e.to_string())?;
    // A drop moves the finish by the same rule a start edit uses, so dropping work on a
    // later day records the reschedule the delay ledger exists for.
    let anchor = crate::services::timing::anchor_for(local_today(now)?, Some(day));
    let finish = crate::services::timing::finish_for(anchor, effort);
    crate::services::timing::write_finish_in(&tx, task_id, finish, now)?;
    crate::services::subtasks::sync_parent(&tx, task_id, now)?;
    tx.commit().map_err(|e| e.to_string())
}

pub fn start(conn: &Connection, task_id: &str, now: &str) -> Result<TaskDto, String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let parked: i64 = tx
        .query_row("SELECT parked FROM tasks WHERE id = ?1", [task_id], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if parked == 1 {
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
    fn a_capture_recorded_as_done_lands_complete() {
        let c = db::open_in_memory().unwrap();
        let fields = CaptureFields {
            effort_minutes: Some(120),
            ..Default::default()
        };

        let t = week::capture_with_project(&c, "做完了", &fields, None, true, NOW, "t1").unwrap();

        assert_eq!(t.status, "done");
        assert!(!t.in_week);
        // Without a chosen start the line began this morning; the finish follows the effort.
        assert_eq!(t.actual_effort_minutes, Some(120));
        let start = t.actual_start_at.as_deref().unwrap();
        let finish = t.actual_finish_at.as_deref().unwrap();
        assert_eq!(
            crate::services::local_today(start)
                .unwrap()
                .format("%Y-%m-%d")
                .to_string(),
            local_date(NOW)
        );
        let span = chrono::DateTime::parse_from_rfc3339(finish).unwrap()
            - chrono::DateTime::parse_from_rfc3339(start).unwrap();
        assert_eq!(span.num_minutes(), 120);
        assert!(week::list(&c).unwrap().is_empty());
        assert_eq!(week::list_done(&c, &local_date(NOW)).unwrap().len(), 1);
    }

    #[test]
    fn capture_stores_the_plan_start_and_counts_workdays_from_it() {
        let c = db::open_in_memory().unwrap();
        let fields = CaptureFields {
            expected_start_date: Some("2026-10-21".into()),
            effort_minutes: Some(960),
            ..Default::default()
        };

        let t = week::capture_with_fields(&c, "写方案", &fields, NOW, "t1").unwrap();

        assert_eq!(t.expected_start_date.as_deref(), Some("2026-10-21"));
        assert_eq!(t.expected_finish_date.as_deref(), Some("2026-10-22"));
    }

    #[test]
    fn a_finished_capture_measures_its_pair_from_the_actual_day() {
        let c = db::open_in_memory().unwrap();
        let fields = CaptureFields {
            actual_start_date: Some("2026-10-20".into()),
            actual_effort_minutes: Some(150),
            effort_minutes: Some(480),
            ..Default::default()
        };

        let t = week::capture_with_project(&c, "做完了", &fields, None, true, NOW, "t1").unwrap();

        assert_eq!(t.status, "done");
        assert!(!t.in_week);
        assert_eq!(t.actual_effort_minutes, Some(150));
        let start = t.actual_start_at.as_deref().unwrap();
        let finish = t.actual_finish_at.as_deref().unwrap();
        assert_eq!(
            crate::services::local_today(start).unwrap().format("%Y-%m-%d").to_string(),
            "2026-10-20"
        );
        let start = chrono::DateTime::parse_from_rfc3339(start).unwrap();
        let finish = chrono::DateTime::parse_from_rfc3339(finish).unwrap();
        assert_eq!((finish - start).num_minutes(), 150);
    }

    #[test]
    fn a_started_capture_joins_the_week_as_doing() {
        let c = db::open_in_memory().unwrap();
        let fields = CaptureFields {
            actual_start_date: Some("2026-10-20".into()),
            ..Default::default()
        };

        let t = week::capture_with_fields(&c, "在做", &fields, NOW, "t1").unwrap();

        assert_eq!(t.status, "doing");
        assert!(t.in_week);
        assert!(t.actual_start_at.is_some());
        assert!(t.actual_finish_at.is_none());
    }

    #[test]
    fn a_capture_can_carry_category_note_tags_and_time_mode() {
        let c = db::open_in_memory().unwrap();
        let category = crate::repo::categories::list(&c).unwrap().remove(0);
        let fields = CaptureFields {
            category_id: Some(category.id.clone()),
            note: Some("会后把清单发出去".into()),
            tags: vec!["会议".into(), "上线".into()],
            exclusive: Some(false),
            ..Default::default()
        };

        let t = week::capture_with_fields(&c, "交接", &fields, NOW, "t1").unwrap();

        assert_eq!(t.category_id.as_deref(), Some(category.id.as_str()));
        assert_eq!(t.note.as_deref(), Some("会后把清单发出去"));
        assert!(!t.exclusive);
        assert_eq!(
            t.tags.iter().map(|tag| tag.name.as_str()).collect::<Vec<_>>(),
            vec!["上线", "会议"]
        );
    }

    #[test]
    fn a_bad_plan_or_actual_day_is_rejected() {
        let c = db::open_in_memory().unwrap();
        let plan = CaptureFields {
            expected_start_date: Some("2026-13-01".into()),
            ..Default::default()
        };
        assert_eq!(
            week::capture_with_fields(&c, "写方案", &plan, NOW, "t1").unwrap_err(),
            "invalid_start_date"
        );
        let actual = CaptureFields {
            actual_start_date: Some("2026-13-01".into()),
            ..Default::default()
        };
        assert_eq!(
            week::capture_with_project(&c, "做完了", &actual, None, true, NOW, "t1").unwrap_err(),
            "invalid_actual_time"
        );
    }

    #[test]
    fn a_capture_without_done_still_opens() {
        let c = db::open_in_memory().unwrap();

        let t = week::capture_with_project(
            &c,
            "还要做",
            &CaptureFields::default(),
            None,
            false,
            NOW,
            "t1",
        )
        .unwrap();

        assert_eq!(t.status, "todo");
        assert!(t.in_week);
        assert!(t.actual_finish_at.is_none());
    }

    #[test]
    fn a_done_capture_creates_its_new_project_in_the_same_transaction() {
        let c = db::open_in_memory().unwrap();

        let t = week::capture_with_project(
            &c,
            "做完了",
            &CaptureFields::default(),
            Some("新项目"),
            true,
            NOW,
            "t1",
        )
        .unwrap();

        assert_eq!(t.status, "done");
        assert!(t.project_id.is_some());
    }

    #[test]
    fn a_new_task_follows_the_default_exclusive_setting() {
        let c = db::open_in_memory().unwrap();
        let t = week::capture(&c, "交底", NOW, "t1").unwrap();
        assert!(t.exclusive);

        crate::repo::settings::set(
            &c,
            crate::repo::settings::keys::TASKS_DEFAULT_EXCLUSIVE,
            "false",
        )
        .unwrap();
        let t = week::capture(&c, "交底", NOW, "t2").unwrap();
        assert!(!t.exclusive);

        crate::repo::settings::set(
            &c,
            crate::repo::settings::keys::TASKS_DEFAULT_EXCLUSIVE,
            "true",
        )
        .unwrap();
        let t = week::capture(&c, "交底", NOW, "t3").unwrap();
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
            ..Default::default()
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

        let t = week::capture_with_project(
            &c,
            "写方案",
            &CaptureFields::default(),
            Some(" 华东客户 "),
            false,
            NOW,
            "t1",
        )
        .unwrap();

        let project = crate::repo::projects::find_active_by_name(
            &c,
            "华东客户",
            crate::repo::settings::MODE_WORK,
        )
        .unwrap();
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

        let t = week::capture_with_project(
            &c,
            "写方案",
            &CaptureFields::default(),
            Some("华东客户"),
            false,
            NOW,
            "t1",
        )
        .unwrap();

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

        let t = week::capture_with_project(&c, "写方案", &fields, Some("别的项目"), false, NOW, "t1")
            .unwrap();

        assert_eq!(t.project_id.as_deref(), Some("p1"));
        assert!(crate::repo::projects::find_active_by_name(
            &c,
            "别的项目",
            crate::repo::settings::MODE_WORK,
        )
        .unwrap().is_none());
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
            week::capture_with_project(
                &c,
                "写方案",
                &CaptureFields::default(),
                Some("华东客户"),
                false,
                NOW,
                "t1",
            )
            .is_err()
        );
        assert!(crate::repo::projects::find_active_by_name(
            &c,
            "华东客户",
            crate::repo::settings::MODE_WORK,
        )
        .unwrap().is_none());
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
        let t = week::resolve(&c, "t1", PassAction::Keep, None, None, None, NOW).unwrap();
        assert_eq!(t.carry_count, 1);
        assert!(t.in_week);
    }

    #[test]
    fn park_without_a_date_or_reason_sets_the_task_aside() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        week::start(&c, "t1", NOW).unwrap();

        let t = week::resolve(&c, "t1", PassAction::Park, None, None, None, NOW).unwrap();

        assert!(!t.in_week);
        assert!(t.parked);
        assert!(t.park_until.is_none());
        assert_eq!(t.parked_at.as_deref(), Some(local_date(NOW).as_str()));
        assert!(t.park_reason.is_none());
        assert_eq!(week::list_parked(&c).unwrap().len(), 1);
        assert!(!week::list(&c).unwrap().iter().any(|row| row.id == "t1"));
        assert!(!week::pass_queue(&c).unwrap().iter().any(|row| row.id == "t1"));
    }

    #[test]
    fn park_keeps_the_reason_the_day_and_the_person() {
        let c = db::open_in_memory().unwrap();
        seed_known(&c);
        week::capture_with_fields(&c, "交底", &CaptureFields::default(), NOW, "t1").unwrap();
        week::start(&c, "t1", NOW).unwrap();

        let t = week::resolve(
            &c,
            "t1",
            PassAction::Park,
            Some("2026-11-02"),
            Some("  等甲方回数据  "),
            Some("u1"),
            NOW,
        )
        .unwrap();

        assert!(t.parked);
        assert_eq!(t.park_until.as_deref(), Some("2026-11-02"));
        assert_eq!(t.parked_at.as_deref(), Some(local_date(NOW).as_str()));
        assert_eq!(t.park_reason.as_deref(), Some("等甲方回数据"));
        assert_eq!(t.parked_on_id.as_deref(), Some("u1"));
    }

    #[test]
    fn park_treats_a_blank_reason_as_absent() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        week::start(&c, "t1", NOW).unwrap();

        let t = week::park(&c, "t1", None, Some("   "), None, NOW).unwrap();

        assert!(t.parked);
        assert!(t.park_reason.is_none());
    }

    #[test]
    fn park_rejects_a_past_date() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        assert_eq!(
            week::resolve(&c, "t1", PassAction::Park, Some("2026-10-19"), None, None, NOW)
                .unwrap_err(),
            "park_until_past"
        );
        assert!(week::list(&c).unwrap().iter().any(|t| t.id == "t1"));
    }

    #[test]
    fn park_rejects_an_invalid_date() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        assert_eq!(
            week::resolve(&c, "t1", PassAction::Park, Some("周五"), None, None, NOW).unwrap_err(),
            "invalid_park_date"
        );
    }

    #[test]
    fn park_accepts_a_task_that_has_not_started() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();

        let t = week::park(&c, "t1", None, None, None, NOW).unwrap();

        assert!(t.parked);
        assert!(!t.in_week);
        assert_eq!(t.status, "todo");
        assert!(week::list(&c).unwrap().is_empty());
    }

    #[test]
    fn park_refuses_a_finished_task() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        week::start(&c, "t1", NOW).unwrap();
        crate::services::tasks::set_status(&c, "t1", "done", NOW).unwrap();

        assert_eq!(
            week::park(&c, "t1", None, None, None, NOW).unwrap_err(),
            "task_done"
        );
    }

    #[test]
    fn park_moves_out_of_week() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        week::start(&c, "t1", NOW).unwrap();
        let t = week::resolve(&c, "t1", PassAction::Park, Some("2026-11-02"), None, None, NOW)
            .unwrap();
        assert!(!t.in_week);
        assert!(t.parked);
        assert_eq!(t.park_until.as_deref(), Some("2026-11-02"));
        assert!(t.park_reason.is_none());
    }

    #[test]
    fn cancel_sets_canceled_at_and_leaves_week() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "不再需要", NOW, "t1").unwrap();
        let t = week::resolve(&c, "t1", PassAction::Cancel, None, None, None, NOW).unwrap();
        assert!(t.canceled_at.is_some());
        assert!(!t.in_week);
    }

    #[test]
    fn done_leaves_week() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "做完了", NOW, "t1").unwrap();
        let t = week::resolve(&c, "t1", PassAction::Done, None, None, None, NOW).unwrap();
        assert_eq!(t.status, "done");
        assert!(!t.in_week);
    }

    #[test]
    fn pass_done_closes_a_subtask_and_rolls_up_its_parent() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        let parent = crate::services::subtasks::add(&c, "t1", "收集清单", NOW).unwrap();
        let child = parent.children[0].id.clone();

        let done = week::resolve(&c, &child, PassAction::Done, None, None, None, NOW).unwrap();
        assert_eq!(done.status, "done");

        // The umbrella follows its children and stays off the queue.
        let umbrella = crate::repo::tasks::dto(&c, "t1").unwrap();
        assert_eq!(umbrella.status, "done");
        assert!(!umbrella.in_week);
        assert!(week::pass_queue(&c).unwrap().is_empty());
    }

    #[test]
    fn canceling_a_subtask_updates_its_umbrella() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交付", NOW, "t1").unwrap();
        let parent = crate::services::subtasks::add(&c, "t1", "收集", NOW).unwrap();
        let first = parent.children[0].id.clone();
        let parent = crate::services::subtasks::add(&c, "t1", "汇编", NOW).unwrap();
        let second = parent.children[1].id.clone();
        crate::services::tasks::set_status(&c, &first, "done", NOW).unwrap();

        week::resolve(&c, &second, PassAction::Cancel, None, None, None, NOW).unwrap();

        let umbrella = crate::repo::tasks::dto(&c, "t1").unwrap();
        assert_eq!(umbrella.status, "done");
        assert_eq!(umbrella.effort_minutes, 480);
        assert_eq!(umbrella.children.len(), 1);
    }

    #[test]
    fn canceling_the_last_subtask_returns_the_umbrella_to_the_week() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交付", NOW, "t1").unwrap();
        let parent = crate::services::subtasks::add(&c, "t1", "收集", NOW).unwrap();
        let child = parent.children[0].id.clone();

        week::resolve(&c, &child, PassAction::Cancel, None, None, None, NOW).unwrap();

        let week_ids: Vec<String> = week::list(&c).unwrap().into_iter().map(|t| t.id).collect();
        assert_eq!(week_ids, vec!["t1".to_string()]);
    }

    #[test]
    fn parking_an_umbrella_parks_its_children() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交付", NOW, "t1").unwrap();
        let parent = crate::services::subtasks::add(&c, "t1", "收集", NOW).unwrap();
        let child = parent.children[0].id.clone();
        week::start(&c, &child, NOW).unwrap();

        week::park(&c, "t1", Some("2026-11-02"), Some("等甲方"), None, NOW).unwrap();
        assert!(week::list(&c).unwrap().is_empty());
        // The work is parked with its umbrella, and only the work is listed.
        let parked: Vec<String> = week::list_parked(&c)
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
    fn resuming_an_umbrella_does_not_bring_finished_work_back() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交付", NOW, "t1").unwrap();
        let parent = crate::services::subtasks::add(&c, "t1", "收集", NOW).unwrap();
        let done_child = parent.children[0].id.clone();
        let parent = crate::services::subtasks::add(&c, "t1", "汇编", NOW).unwrap();
        let open_child = parent.children[1].id.clone();
        crate::services::tasks::set_status(&c, &done_child, "done", NOW).unwrap();
        week::start(&c, &open_child, NOW).unwrap();

        week::park(&c, "t1", None, None, None, NOW).unwrap();
        week::resume(&c, "t1", NOW).unwrap();

        let week_ids: Vec<String> = week::list(&c).unwrap().into_iter().map(|t| t.id).collect();
        assert_eq!(week_ids, vec![open_child]);
    }

    #[test]
    fn queue_lists_all_open_items() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "一", NOW, "t1").unwrap();
        week::capture(&c, "二", NOW, "t2").unwrap();
        week::resolve(&c, "t2", PassAction::Done, None, None, None, NOW).unwrap();
        let q = week::pass_queue(&c).unwrap();
        assert_eq!(q.len(), 1);
        assert_eq!(q[0].id, "t1");
    }

    #[test]
    fn stats_counts_added_done_and_delayed() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "一", NOW, "t1").unwrap();
        week::capture(&c, "二", NOW, "t2").unwrap();
        week::resolve(&c, "t1", PassAction::Done, None, None, None, NOW).unwrap();
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
    fn parked_list_hides_completed_tasks() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        c.execute(
            "UPDATE tasks SET status = 'done', in_week = 0, parked = 1,
                    park_until = '2026-11-02'
             WHERE id = 't1'",
            [],
        )
        .unwrap();

        assert!(week::list_parked(&c).unwrap().is_empty());
    }

    #[test]
    fn parked_list_and_resume() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        week::start(&c, "t1", NOW).unwrap();
        week::resolve(
            &c,
            "t1",
            PassAction::Park,
            Some("2026-11-02"),
            Some("等甲方"),
            None,
            NOW,
        )
        .unwrap();
        let parked = week::list_parked(&c).unwrap();
        assert_eq!(parked.len(), 1);
        assert_eq!(parked[0].park_reason.as_deref(), Some("等甲方"));
        let t = week::resume(&c, "t1", NOW).unwrap();
        assert!(t.in_week);
        assert!(!t.parked);
        assert!(t.park_until.is_none());
        assert!(t.parked_at.is_none());
        assert!(t.park_reason.is_none());
        assert!(week::list_parked(&c).unwrap().is_empty());
    }

    #[test]
    fn resume_appends_to_the_end() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "一", NOW, "t1").unwrap();
        week::capture(&c, "二", NOW, "t2").unwrap();
        week::capture(&c, "三", NOW, "t3").unwrap();
        week::start(&c, "t1", NOW).unwrap();
        week::resolve(&c, "t1", PassAction::Park, Some("2026-11-02"), None, None, NOW)
            .unwrap();

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
        assert!(!t.parked);
        assert!(t.park_until.is_none());
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
    fn park_uses_the_local_calendar_day_across_utc_midnight() {
        // 2026-10-20 00:30 local (+08); the UTC date is still 2026-10-19.
        let now = "2026-10-19T16:30:00Z";
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", now, "t1").unwrap();
        week::start(&c, "t1", now).unwrap();

        let t = week::park(&c, "t1", None, None, None, now).unwrap();

        assert_eq!(t.parked_at.as_deref(), Some("2026-10-20"));
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
    fn start_brings_a_parked_task_back() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "一", NOW, "t1").unwrap();
        week::capture(&c, "二", NOW, "t2").unwrap();
        week::start(&c, "t1", NOW).unwrap();
        week::park(&c, "t1", Some("2026-11-02"), None, None, NOW).unwrap();

        let t = week::start(&c, "t1", NOW).unwrap();

        assert_eq!(t.status, "doing");
        assert!(t.in_week);
        assert!(!t.parked);
        assert!(t.park_until.is_none());
        assert!(t.parked_at.is_none());
        assert!(t.park_reason.is_none());
        assert_eq!(t.actual_start_at.as_deref(), Some(NOW));
        let ids: Vec<String> = week::list(&c).unwrap().into_iter().map(|t| t.id).collect();
        assert_eq!(ids, vec!["t2", "t1"]);
    }

    #[test]
    fn place_brings_a_parked_task_back_on_the_dropped_day() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "一", NOW, "t1").unwrap();
        week::capture(&c, "二", NOW, "t2").unwrap();
        week::start(&c, "t1", NOW).unwrap();
        week::park(&c, "t1", Some("2026-11-02"), Some("等甲方"), None, NOW).unwrap();

        week::place(&c, "t1", "2026-10-22", Some("t2"), NOW).unwrap();

        let t = crate::repo::tasks::dto(&c, "t1").unwrap();
        assert!(t.in_week);
        assert!(!t.parked);
        assert!(t.park_until.is_none());
        assert!(t.parked_at.is_none());
        assert!(t.park_reason.is_none());
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
    fn place_on_a_past_day_finishes_on_that_day() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();

        week::place(&c, "t1", "2026-10-19", None, NOW).unwrap();

        let t = crate::repo::tasks::dto(&c, "t1").unwrap();
        assert_eq!(t.expected_start_date.as_deref(), Some("2026-10-19"));
        // A one-day plan dropped on Monday ends on Monday, not today.
        assert_eq!(t.expected_finish_date.as_deref(), Some("2026-10-19"));
        assert!(t.delays.is_empty(), "the finish moved earlier, not later");
    }

    #[test]
    fn place_refuses_a_recurring_occurrence() {
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
        let before = crate::repo::tasks::dto(&c, &id).unwrap();

        // Moving only the start would leave it after the rule's finish, so the drop is refused.
        assert_eq!(
            week::place(&c, &id, "2026-10-22", None, NOW).unwrap_err(),
            "rule_owns_finish"
        );

        let after = crate::repo::tasks::dto(&c, &id).unwrap();
        assert_eq!(after.expected_finish_date, before.expected_finish_date);
        assert!(after.expected_start_date.is_none(), "no start is invented for it");
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
    fn a_finished_umbrella_stands_for_its_done_children() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交付", NOW, "p").unwrap();
        let first = crate::services::subtasks::add(&c, "p", "收集", NOW).unwrap();
        let child = first.children[0].id.clone();
        let second = crate::services::subtasks::add(&c, "p", "汇编", NOW).unwrap();
        let other = second.children[1].id.clone();
        let day = local_date(NOW);

        crate::services::tasks::set_status(&c, &child, "done", NOW).unwrap();
        let done = week::list_done(&c, &day).unwrap();
        let ids: Vec<&str> = done.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(ids, vec![child.as_str()], "one done child still shows alone");
        assert_eq!(week::stats(&c, &day).unwrap().done, 1);

        crate::services::tasks::set_status(&c, &other, "done", NOW).unwrap();
        let done = week::list_done(&c, &day).unwrap();
        let ids: Vec<&str> = done.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(ids, vec!["p"], "the finished umbrella replaces its parts");
        assert_eq!(done[0].status, "done");
        assert!(done[0].actual_finish_at.is_some());
        assert_eq!(week::stats(&c, &day).unwrap().done, 1);
    }

    #[test]
    fn a_canceled_child_does_not_keep_the_umbrella_from_standing() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交付", NOW, "p").unwrap();
        let first = crate::services::subtasks::add(&c, "p", "收集", NOW).unwrap();
        let child = first.children[0].id.clone();
        let second = crate::services::subtasks::add(&c, "p", "汇编", NOW).unwrap();
        let other = second.children[1].id.clone();

        crate::services::tasks::set_status(&c, &child, "done", NOW).unwrap();
        week::resolve(&c, &other, PassAction::Cancel, None, None, None, NOW).unwrap();

        let done = week::list_done(&c, &local_date(NOW)).unwrap();
        let ids: Vec<&str> = done.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(ids, vec!["p"], "the canceled part no longer splits the card");
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
    fn the_done_count_drops_a_task_whose_card_is_filed() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "一", NOW, "t1").unwrap();
        let done = crate::services::tasks::set_status(&c, "t1", "done", NOW).unwrap();
        let day = local_date(NOW);

        assert_eq!(week::stats(&c, &day).unwrap().done, 1);
        crate::services::archive::archive_task(&c, &done.id, NOW).unwrap();

        assert_eq!(
            week::stats(&c, &day).unwrap().done,
            0,
            "the header counts what the week can still draw"
        );
        assert!(week::list_done(&c, &day).unwrap().is_empty());
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
    fn park_keeps_the_person_the_day_and_the_start() {
        let c = db::open_in_memory().unwrap();
        seed_known(&c);
        week::capture(&c, "交底", NOW, "t1").unwrap();

        let t = week::park(&c, "t1", Some("2026-11-02"), None, Some("u1"), NOW).unwrap();

        assert!(t.parked);
        assert!(!t.in_week);
        assert_eq!(t.parked_on_id.as_deref(), Some("u1"));
        assert_eq!(t.park_until.as_deref(), Some("2026-11-02"));
        assert_eq!(t.parked_at.as_deref(), Some(local_date(NOW).as_str()));
        let parked: Vec<String> = week::list_parked(&c)
            .unwrap()
            .into_iter()
            .map(|t| t.id)
            .collect();
        assert_eq!(parked, vec!["t1"]);
        assert!(week::list(&c).unwrap().is_empty(), "a park leaves the week");
    }

    #[test]
    fn park_allows_an_empty_person_and_day() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();

        let t = week::park(&c, "t1", None, None, None, NOW).unwrap();

        assert!(t.parked);
        assert!(t.parked_on_id.is_none());
        assert!(t.park_until.is_none());
    }

    #[test]
    fn park_keeps_the_day_the_park_started() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        week::park(&c, "t1", Some("2026-11-02"), None, None, NOW).unwrap();

        let t = week::park(&c, "t1", Some("2026-11-05"), None, None, "2026-10-21T09:00:00Z")
            .unwrap();

        assert_eq!(t.park_until.as_deref(), Some("2026-11-05"));
        assert_eq!(
            t.parked_at.as_deref(),
            Some("2026-10-20"),
            "moving the day to look again does not restart the park"
        );
    }

    #[test]
    fn park_rejects_a_past_or_invalid_day() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();

        assert_eq!(
            week::park(&c, "t1", Some("2026-10-19"), None, None, NOW).unwrap_err(),
            "park_until_past"
        );
        assert_eq!(
            week::park(&c, "t1", Some("周四"), None, None, NOW).unwrap_err(),
            "invalid_park_date"
        );
        assert!(!crate::repo::tasks::dto(&c, "t1").unwrap().parked);
    }

    #[test]
    fn parking_again_replaces_the_details() {
        let c = db::open_in_memory().unwrap();
        seed_known(&c);
        week::capture(&c, "交底", NOW, "t1").unwrap();
        week::park(&c, "t1", Some("2026-11-02"), Some("等甲方"), Some("u1"), NOW).unwrap();

        let t = week::park(&c, "t1", Some("2026-11-04"), None, None, NOW).unwrap();

        assert!(t.parked);
        assert_eq!(t.park_until.as_deref(), Some("2026-11-04"));
        assert!(t.park_reason.is_none());
        assert!(t.parked_on_id.is_none());
    }

    #[test]
    fn park_cascades_to_live_children() {
        let c = db::open_in_memory().unwrap();
        seed_known(&c);
        week::capture(&c, "交底", NOW, "t1").unwrap();
        let parent = crate::services::subtasks::add(&c, "t1", "发邮件", NOW).unwrap();
        let child_id = parent.children[0].id.clone();
        crate::services::subtasks::add(&c, "t1", "归档", NOW).unwrap();
        c.execute(
            "UPDATE tasks SET status = 'done', in_week = 0 WHERE title = '归档'",
            [],
        )
        .unwrap();

        week::park(&c, "t1", Some("2026-11-05"), None, Some("u1"), NOW).unwrap();

        let child = crate::repo::tasks::dto(&c, &child_id).unwrap();
        assert!(child.parked);
        assert!(!child.in_week);
        assert_eq!(child.park_until.as_deref(), Some("2026-11-05"));
        let done: (i64, i64) = c
            .query_row("SELECT parked, in_week FROM tasks WHERE title = '归档'", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!(done, (0, 0), "a finished child is left alone");
    }

    #[test]
    fn parked_list_orders_by_the_review_day() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "无日期", NOW, "t1").unwrap();
        week::capture(&c, "后天", NOW, "t2").unwrap();
        week::capture(&c, "明天", NOW, "t3").unwrap();
        week::park(&c, "t1", None, None, None, NOW).unwrap();
        week::park(&c, "t2", Some("2026-10-22"), None, None, NOW).unwrap();
        week::park(&c, "t3", Some("2026-10-21"), None, None, NOW).unwrap();

        let ids: Vec<String> = week::list_parked(&c)
            .unwrap()
            .into_iter()
            .map(|t| t.id)
            .collect();
        assert_eq!(ids, vec!["t3", "t2", "t1"]);
    }

    #[test]
    fn resume_and_place_bring_a_parked_task_back() {
        let c = db::open_in_memory().unwrap();
        seed_known(&c);
        week::capture(&c, "一", NOW, "t1").unwrap();
        week::capture(&c, "二", NOW, "t2").unwrap();
        week::park(&c, "t1", Some("2026-11-02"), None, Some("u1"), NOW).unwrap();
        week::park(&c, "t2", Some("2026-11-03"), None, None, NOW).unwrap();

        let t = week::resume(&c, "t1", NOW).unwrap();
        assert!(!t.parked);
        assert!(t.in_week);
        assert!(t.parked_on_id.is_none());
        assert!(t.park_until.is_none());
        assert!(t.parked_at.is_none());

        week::place(&c, "t2", "2026-10-22", None, NOW).unwrap();
        let t = crate::repo::tasks::dto(&c, "t2").unwrap();
        assert!(!t.parked);
        assert!(t.in_week);
        assert_eq!(t.expected_start_date.as_deref(), Some("2026-10-22"));
    }

    #[test]
    fn a_pass_finished_on_the_weekend_counts_for_the_coming_week() {
        let c = db::open_in_memory().unwrap();
        let start = week::mark_pass_done(&c, "2026-10-24").unwrap();
        assert_eq!(start, "2026-10-26");
        let stored = crate::repo::settings::get(&c, "last_pass_week").unwrap();
        assert_eq!(stored.as_deref(), Some(start.as_str()));
    }

    #[test]
    fn the_weekly_pass_is_cleared_per_mode() {
        let c = db::open_in_memory().unwrap();
        let company_week = week::mark_pass_done(&c, "2026-10-20").unwrap();
        assert_eq!(
            crate::repo::settings::dto(&c).unwrap().last_pass_week,
            company_week
        );

        crate::repo::settings::set(
            &c,
            crate::repo::settings::keys::MODE,
            crate::repo::settings::MODE_PERSONAL,
        )
        .unwrap();
        assert_eq!(crate::repo::settings::dto(&c).unwrap().last_pass_week, "");
        let personal_week = week::mark_pass_done(&c, "2026-10-20").unwrap();
        assert_eq!(
            crate::repo::settings::dto(&c).unwrap().last_pass_week,
            personal_week
        );

        crate::repo::settings::set(
            &c,
            crate::repo::settings::keys::MODE,
            crate::repo::settings::MODE_WORK,
        )
        .unwrap();
        assert_eq!(
            crate::repo::settings::dto(&c).unwrap().last_pass_week,
            company_week
        );
    }

    #[test]
    fn a_subtask_and_a_moved_task_follow_their_world() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "公司串", NOW, "t-work").unwrap();

        crate::repo::settings::set(
            &c,
            crate::repo::settings::keys::MODE,
            crate::repo::settings::MODE_PERSONAL,
        )
        .unwrap();
        week::capture(&c, "个人大事", NOW, "t-personal").unwrap();
        crate::services::subtasks::add(&c, "t-personal", "第一步", NOW).unwrap();
        let child_scope: String = c
            .query_row(
                "SELECT scope FROM tasks WHERE parent_id = 't-personal'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(child_scope, crate::repo::settings::MODE_PERSONAL);

        let project = crate::services::projects::create(&c, "生活", NOW).unwrap();
        crate::services::tasks::update_patch(
            &c,
            "t-work",
            &crate::dto::TaskPatch {
                project_id: Some(Some(project.id.clone())),
                ..Default::default()
            },
            NOW,
        )
        .unwrap();
        let moved_scope: String = c
            .query_row("SELECT scope FROM tasks WHERE id = 't-work'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(moved_scope, crate::repo::settings::MODE_PERSONAL);
    }
}
