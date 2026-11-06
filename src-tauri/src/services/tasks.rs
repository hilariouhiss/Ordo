use crate::dto::{TaskDto, TaskPatch};
use rusqlite::Connection;

/// Minutes of work: one minute up to 480 hours (sixty eight-hour days).
pub fn valid_effort(minutes: i64) -> bool {
    (1..=28800).contains(&minutes)
}

pub fn valid_priority(priority: &str) -> bool {
    matches!(priority, "high" | "normal" | "low")
}

pub fn update_patch(
    conn: &Connection,
    id: &str,
    patch: &TaskPatch,
    now: &str,
) -> Result<TaskDto, String> {
    let mut patch = patch.clone();
    if let Some(priority) = patch.priority.as_deref() {
        if !valid_priority(priority) {
            return Err("invalid_priority".into());
        }
    }

    // A recurring rule owns its occurrence's day: moving it would make the next tick
    // create a second occurrence for the day the rule still expects.
    if patch.expected_finish_date.is_some() && rule_owned(conn, id)? {
        return Err("rule_owns_finish".into());
    }

    // A picked finish day also sets the estimate, so the date and the estimate the
    // sheet shows can never disagree. A weekend pick reads as the Friday before it,
    // which is the last day the estimate counts.
    let picked_finish = match patch.expected_finish_date.as_ref() {
        Some(Some(text)) => {
            let finish = crate::services::timing::workday_on_or_before(
                chrono::NaiveDate::parse_from_str(text, "%Y-%m-%d")
                    .map_err(|_| "invalid_finish_date")?,
            );
            patch.expected_finish_date = Some(Some(finish.format("%Y-%m-%d").to_string()));
            let start = match patch.expected_start_date.as_ref() {
                Some(value) => value.clone(),
                None => expected_start_of(conn, id)?,
            };
            let anchor = crate::services::timing::anchor_for(
                crate::services::local_today(now)?,
                start.as_deref(),
            );
            patch.effort_minutes =
                Some(crate::services::timing::effort_for_finish(anchor, finish)?);
            Some(finish)
        }
        _ => None,
    };

    if let Some(effort) = patch.effort_minutes {
        if !valid_effort(effort) {
            return Err("invalid_effort".into());
        }
        // Manual step shares are a floor: lowering the estimate under them would
        // leave the steps bigger than the task, so the sheet asks for a bigger number.
        let manual = crate::repo::steps::manual_effort_sum(conn, id).map_err(|e| e.to_string())?;
        if manual > effort {
            return Err("steps_over_effort".into());
        }
    }

    // One transaction: a refused actual time or a failed write must not leave the other
    // fields committed, so a save is all or nothing.
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    if let Some(finish) = picked_finish {
        // The ledger records a later day in the same transaction as the row.
        crate::services::timing::write_finish_in(&tx, id, finish, now)?;
    }
    crate::repo::tasks::apply_patch_in(&tx, id, &patch, now).map_err(|e| e.to_string())?;
    // A picked finish owns the date; an estimate or start edit derives it otherwise.
    // An explicit clear stays cleared even when the same edit moves the estimate.
    let finish_cleared = matches!(patch.expected_finish_date.as_ref(), Some(None));
    if picked_finish.is_none()
        && !finish_cleared
        && (patch.effort_minutes.is_some() || patch.expected_start_date.is_some())
    {
        crate::services::timing::sync_finish_in(&tx, id, now)?;
    }
    sync_actual_in(&tx, id, &patch, now)?;
    route_owner(&tx, id, &patch, now)?;
    // Moving a task or changing its owner must not leave an owner outside the project.
    if patch.project_id.is_some() || patch.owner_id.is_some() {
        let task = crate::repo::tasks::dto(&tx, id).map_err(|e| e.to_string())?;
        crate::services::projects::ensure_member(
            &tx,
            task.project_id.as_deref(),
            task.owner_id.as_deref(),
            now,
        )?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    crate::repo::tasks::dto(conn, id).map_err(|e| e.to_string())
}

fn expected_start_of(conn: &Connection, id: &str) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT expected_start_date FROM tasks WHERE id = ?1",
        [id],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

fn rule_owned(conn: &Connection, id: &str) -> Result<bool, String> {
    conn.query_row("SELECT rule_id IS NOT NULL FROM tasks WHERE id = ?1", [id], |row| {
        row.get(0)
    })
    .map_err(|e| e.to_string())
}

fn has_open_steps(conn: &Connection, id: &str) -> Result<bool, String> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM steps
                       WHERE task_id = ?1 AND deleted_at IS NULL AND done = 0)",
        [id],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

/// Hands the actual times between finish and effort. The actual start is the anchor
/// both directions measure from, so setting either one without it is refused; clearing
/// still works, so a task finished before it was started can be tidied up. The caller
/// owns the transaction, so its field writes and these land together.
fn sync_actual_in(
    conn: &Connection,
    id: &str,
    patch: &TaskPatch,
    now: &str,
) -> Result<(), String> {
    if patch.actual_start_at.is_none()
        && patch.actual_finish_at.is_none()
        && patch.actual_effort_minutes.is_none()
    {
        return Ok(());
    }
    // Steps own completion: ticking the last one stamps the finish and effort itself,
    // so a hand-entered pair would only fight the derived status.
    let setting_finish = patch
        .actual_finish_at
        .as_ref()
        .is_some_and(|value| value.is_some());
    let setting_effort = patch
        .actual_effort_minutes
        .as_ref()
        .is_some_and(|value| value.is_some());
    if (setting_finish || setting_effort) && has_open_steps(conn, id)? {
        return Err("steps_open".into());
    }
    let (stored_start, stored_finish, stored_effort, status): (
        Option<String>,
        Option<String>,
        Option<i64>,
        String,
    ) = conn
        .query_row(
            "SELECT started_at, actual_finish_at, actual_effort_minutes, status
             FROM tasks WHERE id = ?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .map_err(|e| e.to_string())?;

    let start = match &patch.actual_start_at {
        Some(value) => value.as_deref().map(normalize_stamp).transpose()?,
        None => stored_start,
    };
    let start_changed = patch.actual_start_at.is_some();

    let mut finish = stored_finish;
    let mut reopen = false;
    match &patch.actual_finish_at {
        Some(Some(text)) => finish = Some(normalize_stamp(text)?),
        Some(None) => {
            finish = None;
            reopen = true;
        }
        None => {}
    }

    // Moving the effort moves the finish, but only around a real start.
    if patch.actual_finish_at.is_none() {
        if let Some(Some(minutes)) = &patch.actual_effort_minutes {
            if !valid_effort(*minutes) {
                return Err("invalid_effort".into());
            }
            if let Some(start) = &start {
                finish = Some(add_minutes(start, *minutes)?);
            }
        }
    }

    if start.is_none()
        && (patch
            .actual_finish_at
            .as_ref()
            .is_some_and(|value| value.is_some())
            || patch
                .actual_effort_minutes
                .as_ref()
                .is_some_and(|value| value.is_some()))
    {
        return Err("actual_start_required".into());
    }

    let mut effort = match &patch.actual_effort_minutes {
        Some(value) => *value,
        None => stored_effort,
    };
    if let (Some(start), Some(finish)) = (&start, &finish) {
        let minutes = minutes_between(start, finish)?;
        if minutes < 0 {
            return Err("finish_before_start".into());
        }
        effort = Some(minutes.clamp(1, 28800));
    }
    if reopen {
        effort = None;
    }

    conn.execute(
        "UPDATE tasks SET started_at = ?1, actual_finish_at = ?2, actual_effort_minutes = ?3,
                updated_at = ?4 WHERE id = ?5",
        rusqlite::params![start, finish, effort, now, id],
    )
    .map_err(|e| e.to_string())?;
    if finish.is_some() && status != "done" {
        crate::repo::tasks::set_status_only(conn, id, "done", true, now)
            .map_err(|e| e.to_string())?;
    } else if reopen && status == "done" {
        crate::repo::tasks::set_status_only(conn, id, "doing", false, now)
            .map_err(|e| e.to_string())?;
    } else if start_changed && start.is_some() && status == "todo" && finish.is_none() {
        crate::repo::tasks::set_status_only(conn, id, "doing", false, now)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn parse_stamp(text: &str) -> Result<chrono::DateTime<chrono::Utc>, String> {
    chrono::DateTime::parse_from_rfc3339(text)
        .map(|stamp| stamp.with_timezone(&chrono::Utc))
        .map_err(|_| "invalid_actual_time".to_string())
}

fn normalize_stamp(text: &str) -> Result<String, String> {
    Ok(parse_stamp(text)?.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
}

fn add_minutes(start: &str, minutes: i64) -> Result<String, String> {
    Ok((parse_stamp(start)? + chrono::Duration::minutes(minutes))
        .to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
}

fn minutes_between(start: &str, finish: &str) -> Result<i64, String> {
    Ok((parse_stamp(finish)? - parse_stamp(start)?).num_minutes())
}

/// A category or project change hands the task to that specialty's owner unless the
/// same edit picked an owner explicitly.
fn route_owner(conn: &Connection, id: &str, patch: &TaskPatch, now: &str) -> Result<(), String> {
    if patch.owner_id.is_some() || (patch.project_id.is_none() && patch.category_id.is_none()) {
        return Ok(());
    }
    let task = crate::repo::tasks::dto(conn, id).map_err(|e| e.to_string())?;
    let owner = crate::services::projects::assigned_owner(
        conn,
        task.project_id.as_deref(),
        task.category_id.as_deref(),
    )?;
    match owner {
        Some(owner) if task.owner_id.as_deref() != Some(owner.as_str()) => {
            crate::repo::tasks::set_owner(conn, id, &owner, now).map_err(|e| e.to_string())
        }
        _ => Ok(()),
    }
}

/// The order values a move would change, so a caller can apply them inside its own
/// transaction instead of nesting one.
pub fn order_changes(
    conn: &Connection,
    task_id: &str,
    before_id: Option<&str>,
) -> Result<Vec<(String, i64)>, String> {
    let rows = crate::repo::tasks::ordered_rows(conn).map_err(|e| e.to_string())?;
    let from = rows
        .iter()
        .position(|(id, _)| id.as_str() == task_id)
        .ok_or("task_not_found")?;
    let mut rest = rows;
    let moved = rest.remove(from);
    let to = match before_id {
        Some(before) if before == task_id => return Ok(vec![]),
        Some(before) => rest
            .iter()
            .position(|(id, _)| id.as_str() == before)
            .ok_or("task_not_found")?,
        None => rest.len(),
    };
    if to == from {
        return Ok(vec![]);
    }
    rest.insert(to, moved);
    let mut changes = Vec::new();
    for (index, (id, order)) in rest.into_iter().enumerate() {
        if index as i64 != order {
            changes.push((id, index as i64));
        }
    }
    Ok(changes)
}

/// Puts a task just before `before_id`, or last when there is no anchor.
pub fn move_task(conn: &Connection, task_id: &str, before_id: Option<&str>) -> Result<(), String> {
    let changes = order_changes(conn, task_id, before_id)?;
    crate::repo::tasks::write_orders(conn, &changes).map_err(|e| e.to_string())
}

pub fn set_status(conn: &Connection, id: &str, status: &str, now: &str) -> Result<TaskDto, String> {
    if !["todo", "doing", "done"].contains(&status) {
        return Err("invalid_status".into());
    }
    // The actual start and finish store this stamp verbatim, so reject a malformed one
    // before anything is written.
    crate::services::local_today(now)?;
    let done = status == "done";
    crate::repo::tasks::set_status(conn, id, status, done, now).map_err(|e| e.to_string())?;
    crate::repo::tasks::dto(conn, id).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use crate::db;
    use crate::dto::{CaptureFields, TaskPatch};
    use crate::services::{projects, tasks, week};
    use rusqlite::Connection;

    const NOW: &str = "2026-10-20T08:00:00Z";

    fn category(c: &Connection, name: &str) -> String {
        crate::repo::categories::list(c)
            .unwrap()
            .into_iter()
            .find(|x| x.name == name)
            .unwrap()
            .id
    }

    fn seed_project(c: &Connection, id: &str) {
        c.execute(
            "INSERT INTO projects (id, name, created_at, updated_at) VALUES (?1, ?1, ?2, ?2)",
            rusqlite::params![id, NOW],
        )
        .unwrap();
    }

    #[test]
    fn patch_only_title_keeps_other_fields() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "原标题", NOW, "t1").unwrap();
        seed_project(&c, "p1");
        c.execute(
            "UPDATE tasks SET project_id='p1', note='旧备注' WHERE id='t1'",
            [],
        )
        .unwrap();
        let patch = TaskPatch {
            title: Some("新标题".into()),
            ..Default::default()
        };
        let t = tasks::update_patch(&c, "t1", &patch, NOW).unwrap();
        assert_eq!(t.title, "新标题");
        assert_eq!(t.project_id.as_deref(), Some("p1"));
        assert_eq!(t.note.as_deref(), Some("旧备注"));
    }

    #[test]
    fn patch_null_clears_a_field() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "留住的", NOW, "t1").unwrap();
        seed_project(&c, "p1");
        c.execute("UPDATE tasks SET project_id='p1' WHERE id='t1'", [])
            .unwrap();
        let patch = TaskPatch {
            project_id: Some(None),
            ..Default::default()
        };
        let t = tasks::update_patch(&c, "t1", &patch, NOW).unwrap();
        assert!(t.project_id.is_none());
    }

    #[test]
    fn moving_a_task_to_another_project_keeps_the_owner_a_member() {
        let c = db::open_in_memory().unwrap();
        let old = projects::create(&c, "旧项目", NOW).unwrap();
        let new = projects::create(&c, "新项目", NOW).unwrap();
        let li = projects::add_member(&c, &old.id, None, Some("老李"), NOW).unwrap();
        let fields = CaptureFields {
            project_id: Some(old.id.clone()),
            owner_id: Some(li.id.clone()),
            ..Default::default()
        };
        week::capture_with_fields(&c, "交底", &fields, NOW, "t1").unwrap();

        let patch = TaskPatch {
            project_id: Some(Some(new.id.clone())),
            ..Default::default()
        };
        tasks::update_patch(&c, "t1", &patch, NOW).unwrap();

        assert!(
            crate::repo::projects::is_member(&c, &new.id, &li.id).unwrap(),
            "the owner must be a member of the project that now holds the task"
        );
    }

    #[test]
    fn a_category_change_routes_the_task_to_the_specialty_owner() {
        let c = db::open_in_memory().unwrap();
        let p = projects::create(&c, "项目", NOW).unwrap();
        let li = projects::add_member(&c, &p.id, None, Some("老李"), NOW).unwrap();
        let hardware = category(&c, "硬件");
        projects::set_member_category(&c, &p.id, &li.id, Some(&hardware), NOW).unwrap();
        let fields = CaptureFields {
            project_id: Some(p.id.clone()),
            ..Default::default()
        };
        week::capture_with_fields(&c, "交底", &fields, NOW, "t1").unwrap();

        let patch = TaskPatch {
            category_id: Some(Some(hardware)),
            ..Default::default()
        };
        let task = tasks::update_patch(&c, "t1", &patch, NOW).unwrap();

        assert_eq!(task.owner_id.as_deref(), Some(li.id.as_str()));
    }

    #[test]
    fn an_explicit_owner_wins_over_the_specialty_route() {
        let c = db::open_in_memory().unwrap();
        let p = projects::create(&c, "项目", NOW).unwrap();
        let li = projects::add_member(&c, &p.id, None, Some("老李"), NOW).unwrap();
        let hardware = category(&c, "硬件");
        projects::set_member_category(&c, &p.id, &li.id, Some(&hardware), NOW).unwrap();
        let wang = crate::repo::people::create(&c, "u-wang", "小王", NOW).unwrap();
        let fields = CaptureFields {
            project_id: Some(p.id.clone()),
            ..Default::default()
        };
        week::capture_with_fields(&c, "交底", &fields, NOW, "t1").unwrap();

        let patch = TaskPatch {
            category_id: Some(Some(hardware)),
            owner_id: Some(Some(wang.id.clone())),
            ..Default::default()
        };
        let task = tasks::update_patch(&c, "t1", &patch, NOW).unwrap();

        assert_eq!(task.owner_id.as_deref(), Some(wang.id.as_str()));
    }

    #[test]
    fn moving_a_task_to_another_project_picks_up_its_specialty_owner() {
        let c = db::open_in_memory().unwrap();
        let source = projects::create(&c, "旧项目", NOW).unwrap();
        let target = projects::create(&c, "新项目", NOW).unwrap();
        let li = projects::add_member(&c, &target.id, None, Some("老李"), NOW).unwrap();
        let hardware = category(&c, "硬件");
        projects::set_member_category(&c, &target.id, &li.id, Some(&hardware), NOW).unwrap();
        let fields = CaptureFields {
            project_id: Some(source.id.clone()),
            ..Default::default()
        };
        week::capture_with_fields(&c, "交底", &fields, NOW, "t1").unwrap();
        let patch = TaskPatch {
            category_id: Some(Some(hardware)),
            ..Default::default()
        };
        let task = tasks::update_patch(&c, "t1", &patch, NOW).unwrap();
        assert_ne!(task.owner_id.as_deref(), Some(li.id.as_str()));

        let patch = TaskPatch {
            project_id: Some(Some(target.id.clone())),
            ..Default::default()
        };
        let task = tasks::update_patch(&c, "t1", &patch, NOW).unwrap();

        assert_eq!(task.owner_id.as_deref(), Some(li.id.as_str()));
    }

    #[test]
    fn a_tags_only_patch_still_bumps_updated_at() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        c.execute(
            "UPDATE tasks SET updated_at = '2000-01-01T00:00:00Z' WHERE id = 't1'",
            [],
        )
        .unwrap();
        let patch = TaskPatch {
            tags: Some(vec!["fix".into()]),
            ..Default::default()
        };
        let t = tasks::update_patch(&c, "t1", &patch, NOW).unwrap();
        assert_eq!(t.updated_at, NOW);
        assert_eq!(t.tags.len(), 1);
    }

    /// A fixed start in the future keeps the anchor independent of the machine's timezone.
    fn future_start(c: &Connection) {
        let patch = TaskPatch {
            expected_start_date: Some(Some("2026-10-21".into())),
            ..Default::default()
        };
        tasks::update_patch(c, "t1", &patch, NOW).unwrap();
    }

    #[test]
    fn an_edited_finish_back_computes_the_effort_and_records_the_move() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        future_start(&c);

        let patch: TaskPatch =
            serde_json::from_str(r#"{"expectedFinishDate":"2026-10-23"}"#).unwrap();
        let t = tasks::update_patch(&c, "t1", &patch, NOW).unwrap();

        assert_eq!(t.expected_finish_date.as_deref(), Some("2026-10-23"));
        assert_eq!(t.effort_minutes, 1440);
        assert!(
            t.delays
                .iter()
                .any(|d| d.kind == "reschedule" && d.new_due.as_deref() == Some("2026-10-23")),
            "{:?}",
            t.delays
        );
    }

    #[test]
    fn a_picked_finish_replaces_an_estimate_sent_with_it() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        future_start(&c);

        let patch = TaskPatch {
            expected_finish_date: Some(Some("2026-10-23".into())),
            effort_minutes: Some(480),
            ..Default::default()
        };
        let t = tasks::update_patch(&c, "t1", &patch, NOW).unwrap();

        assert_eq!(t.expected_finish_date.as_deref(), Some("2026-10-23"));
        assert_eq!(t.effort_minutes, 1440);
    }

    #[test]
    fn a_weekend_finish_is_stored_on_the_friday_before_it() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        future_start(&c);

        let patch = TaskPatch {
            expected_finish_date: Some(Some("2026-10-25".into())),
            ..Default::default()
        };
        let t = tasks::update_patch(&c, "t1", &patch, NOW).unwrap();

        assert_eq!(t.expected_finish_date.as_deref(), Some("2026-10-23"));
        assert_eq!(t.effort_minutes, 1440);
    }

    #[test]
    fn a_picked_finish_on_a_rule_task_is_rejected() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        c.execute(
            "INSERT INTO task_rules (id, title, weekdays, at_time, created_at, updated_at)
             VALUES ('r1', '周报', '[1,2,3,4,5]', '09:00', ?1, ?1)",
            [NOW],
        )
        .unwrap();
        c.execute("UPDATE tasks SET rule_id = 'r1' WHERE id = 't1'", [])
            .unwrap();

        let patch = TaskPatch {
            expected_finish_date: Some(Some("2026-10-23".into())),
            ..Default::default()
        };
        assert_eq!(
            tasks::update_patch(&c, "t1", &patch, NOW).unwrap_err(),
            "rule_owns_finish"
        );
    }

    #[test]
    fn a_cleared_finish_stays_cleared_when_the_estimate_changes_too() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();

        let patch = TaskPatch {
            expected_finish_date: Some(None),
            effort_minutes: Some(960),
            ..Default::default()
        };
        let t = tasks::update_patch(&c, "t1", &patch, NOW).unwrap();

        assert!(t.expected_finish_date.is_none());
        assert_eq!(t.effort_minutes, 960);
    }

    #[test]
    fn a_finish_before_the_anchor_is_rejected() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        future_start(&c);

        let patch = TaskPatch {
            expected_finish_date: Some(Some("2026-10-20".into())),
            ..Default::default()
        };
        assert_eq!(
            tasks::update_patch(&c, "t1", &patch, NOW).unwrap_err(),
            "finish_before_start"
        );
    }

    #[test]
    fn a_finish_beyond_sixty_workdays_is_rejected() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        future_start(&c);

        let patch = TaskPatch {
            expected_finish_date: Some(Some("2027-02-01".into())),
            ..Default::default()
        };
        assert_eq!(
            tasks::update_patch(&c, "t1", &patch, NOW).unwrap_err(),
            "finish_too_far"
        );
    }

    #[test]
    fn a_cleared_finish_leaves_the_effort_alone() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();

        let patch = TaskPatch {
            expected_finish_date: Some(None),
            ..Default::default()
        };
        let t = tasks::update_patch(&c, "t1", &patch, NOW).unwrap();

        assert!(t.expected_finish_date.is_none());
        assert_eq!(t.effort_minutes, 480);
    }

    #[test]
    fn patch_json_distinguishes_absent_from_null() {
        let patch: TaskPatch = serde_json::from_str(r#"{"title":"新"}"#).unwrap();
        assert_eq!(patch.title.as_deref(), Some("新"));
        assert!(patch.project_id.is_none());

        let patch: TaskPatch = serde_json::from_str(r#"{"projectId":null}"#).unwrap();
        assert_eq!(patch.project_id, Some(None));
    }

    #[test]
    fn manual_done_leaves_week_and_undo_returns() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "做完了", NOW, "t1").unwrap();
        let t = tasks::set_status(&c, "t1", "done", NOW).unwrap();
        assert_eq!(t.status, "done");
        assert!(!t.in_week);

        let back = tasks::set_status(&c, "t1", "doing", NOW).unwrap();
        assert!(back.in_week);
        let finished_at: Option<String> = c
            .query_row(
                "SELECT actual_finish_at FROM tasks WHERE id='t1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(finished_at.is_none());
    }

    #[test]
    fn manual_doing_stamps_the_actual_start_without_touching_the_plan() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        c.execute(
            "UPDATE tasks SET expected_start_date = '2026-10-22' WHERE id = 't1'",
            [],
        )
        .unwrap();

        let t = tasks::set_status(&c, "t1", "doing", NOW).unwrap();

        assert_eq!(t.actual_start_at.as_deref(), Some(NOW));
        assert_eq!(t.expected_start_date.as_deref(), Some("2026-10-22"));
        let earlier = "2026-10-21T08:00:00Z";
        let again = tasks::set_status(&c, "t1", "todo", earlier).unwrap();
        assert_eq!(again.actual_start_at.as_deref(), Some(NOW));
    }

    #[test]
    fn finishing_stamps_the_actual_finish() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();

        let t = tasks::set_status(&c, "t1", "done", NOW).unwrap();

        assert_eq!(t.actual_finish_at.as_deref(), Some(NOW));
    }

    #[test]
    fn finishing_records_the_time_the_work_really_took() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        tasks::set_status(&c, "t1", "doing", NOW).unwrap();

        let t = tasks::set_status(&c, "t1", "done", "2026-10-20T10:30:00Z").unwrap();

        assert_eq!(t.actual_effort_minutes, Some(150));
    }

    #[test]
    fn finishing_without_a_start_records_the_estimate() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();

        let t = tasks::set_status(&c, "t1", "done", "2026-10-20T09:00:00Z").unwrap();

        assert_eq!(t.actual_effort_minutes, Some(480));
    }

    #[test]
    fn a_quick_finish_still_records_one_minute_and_reopening_clears_it() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        tasks::set_status(&c, "t1", "doing", NOW).unwrap();

        let t = tasks::set_status(&c, "t1", "done", NOW).unwrap();
        assert_eq!(t.actual_effort_minutes, Some(1));

        let back = tasks::set_status(&c, "t1", "todo", NOW).unwrap();
        assert!(back.actual_effort_minutes.is_none());
    }

    #[test]
    fn update_patch_replaces_tags() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        let patch = TaskPatch {
            tags: Some(vec!["fix".into(), "交付".into()]),
            ..Default::default()
        };
        let names = |t: &crate::dto::TaskDto| -> Vec<String> {
            t.tags.iter().map(|tag| tag.name.clone()).collect()
        };
        let t = tasks::update_patch(&c, "t1", &patch, NOW).unwrap();
        assert_eq!(names(&t), vec!["fix", "交付"]);

        let patch = TaskPatch {
            tags: Some(vec!["fix".into()]),
            ..Default::default()
        };
        let t = tasks::update_patch(&c, "t1", &patch, NOW).unwrap();
        assert_eq!(names(&t), vec!["fix"]);
    }

    fn ordered(c: &Connection) -> Vec<String> {
        crate::repo::tasks::ordered_rows(c)
            .unwrap()
            .into_iter()
            .map(|(id, _)| id)
            .collect()
    }

    fn three_tasks() -> Connection {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "一", NOW, "t1").unwrap();
        week::capture(&c, "二", NOW, "t2").unwrap();
        week::capture(&c, "三", NOW, "t3").unwrap();
        c
    }

    #[test]
    fn move_task_puts_a_task_before_another() {
        let c = three_tasks();
        tasks::move_task(&c, "t3", Some("t1")).unwrap();
        assert_eq!(ordered(&c), vec!["t3", "t1", "t2"]);
    }

    #[test]
    fn move_to_the_end_with_none() {
        let c = three_tasks();
        tasks::move_task(&c, "t1", None).unwrap();
        assert_eq!(ordered(&c), vec!["t2", "t3", "t1"]);
    }

    #[test]
    fn move_task_keeps_updated_at_and_renumbers_densely() {
        let c = three_tasks();
        crate::repo::tasks::archive(&c, "t2", NOW).unwrap();
        c.execute(
            "UPDATE tasks SET updated_at = '2000-01-01T00:00:00Z'",
            [],
        )
        .unwrap();

        tasks::move_task(&c, "t3", Some("t1")).unwrap();

        let mut stmt = c.prepare("SELECT updated_at FROM tasks").unwrap();
        let stamps: Vec<String> = stmt
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        assert!(stamps.iter().all(|s| s == "2000-01-01T00:00:00Z"));

        let mut stmt = c
            .prepare("SELECT sort_order FROM tasks ORDER BY sort_order")
            .unwrap();
        let orders: Vec<i64> = stmt
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        assert_eq!(orders, vec![0, 1, 2]);
    }

    #[test]
    fn move_task_anchors_through_tasks_outside_the_week() {
        let c = three_tasks();
        c.execute("UPDATE tasks SET in_week = 0 WHERE id = 't2'", [])
            .unwrap();

        tasks::move_task(&c, "t3", Some("t2")).unwrap();

        assert_eq!(ordered(&c), vec!["t1", "t3", "t2"]);
        let week_ids: Vec<String> = week::list(&c)
            .unwrap()
            .into_iter()
            .map(|t| t.id)
            .collect();
        assert_eq!(week_ids, vec!["t1", "t3"]);
    }

    #[test]
    fn moving_into_its_own_slot_writes_nothing() {
        let c = three_tasks();
        tasks::move_task(&c, "t2", Some("t3")).unwrap();
        assert_eq!(ordered(&c), vec!["t1", "t2", "t3"]);
    }

    #[test]
    fn a_move_writes_only_the_rows_that_change_place() {
        let c = db::open_in_memory().unwrap();
        for id in ["t1", "t2", "t3", "t4", "t5"] {
            week::capture(&c, id, NOW, id).unwrap();
        }
        c.execute_batch(
            "CREATE TABLE order_writes (id TEXT);
             CREATE TRIGGER log_order AFTER UPDATE OF sort_order ON tasks
             BEGIN INSERT INTO order_writes (id) VALUES (OLD.id); END;",
        )
        .unwrap();

        tasks::move_task(&c, "t2", Some("t4")).unwrap();

        let writes: i64 = c
            .query_row("SELECT COUNT(*) FROM order_writes", [], |r| r.get(0))
            .unwrap();
        assert_eq!(writes, 2, "only t2 and t3 change place");
        assert_eq!(ordered(&c), vec!["t1", "t3", "t2", "t4", "t5"]);
    }

    #[test]
    fn move_onto_itself_is_a_noop() {
        let c = three_tasks();
        tasks::move_task(&c, "t2", Some("t2")).unwrap();
        assert_eq!(ordered(&c), vec!["t1", "t2", "t3"]);
    }

    #[test]
    fn unknown_task_is_rejected() {
        let c = three_tasks();
        assert_eq!(
            tasks::move_task(&c, "nope", Some("t1")).unwrap_err(),
            "task_not_found"
        );
        assert_eq!(
            tasks::move_task(&c, "t1", Some("nope")).unwrap_err(),
            "task_not_found"
        );
    }

    #[test]
    fn effort_is_validated_and_saved() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();

        let bad = TaskPatch {
            effort_minutes: Some(0),
            ..Default::default()
        };
        assert_eq!(
            tasks::update_patch(&c, "t1", &bad, NOW).unwrap_err(),
            "invalid_effort"
        );

        let patch = TaskPatch {
            title: Some("改名".into()),
            effort_minutes: Some(150),
            ..Default::default()
        };
        let t = tasks::update_patch(&c, "t1", &patch, NOW).unwrap();
        assert_eq!(t.title, "改名");
        assert_eq!(t.effort_minutes, 150);

        let later = TaskPatch {
            title: Some("再改".into()),
            ..Default::default()
        };
        let t = tasks::update_patch(&c, "t1", &later, NOW).unwrap();
        assert_eq!(t.effort_minutes, 150);

        for accepted in [1, 28800] {
            let patch = TaskPatch {
                effort_minutes: Some(accepted),
                ..Default::default()
            };
            let t = tasks::update_patch(&c, "t1", &patch, NOW).unwrap();
            assert_eq!(t.effort_minutes, accepted);
        }
        for rejected in [0, 28801] {
            let patch = TaskPatch {
                effort_minutes: Some(rejected),
                ..Default::default()
            };
            assert_eq!(
                tasks::update_patch(&c, "t1", &patch, NOW).unwrap_err(),
                "invalid_effort"
            );
        }
    }

    #[test]
    fn exclusive_is_saved_and_kept_by_other_patches() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "出差", NOW, "t1").unwrap();

        let patch = TaskPatch {
            exclusive: Some(true),
            ..Default::default()
        };
        assert!(tasks::update_patch(&c, "t1", &patch, NOW).unwrap().exclusive);

        let later = TaskPatch {
            title: Some("出差（改）".into()),
            ..Default::default()
        };
        assert!(tasks::update_patch(&c, "t1", &later, NOW).unwrap().exclusive);

        let clear = TaskPatch {
            exclusive: Some(false),
            ..Default::default()
        };
        assert!(!tasks::update_patch(&c, "t1", &clear, NOW).unwrap().exclusive);
    }

    #[test]
    fn priority_is_validated_and_saved() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();

        let bad = TaskPatch {
            priority: Some("urgent".into()),
            ..Default::default()
        };
        assert_eq!(
            tasks::update_patch(&c, "t1", &bad, NOW).unwrap_err(),
            "invalid_priority"
        );

        for accepted in ["high", "normal", "low"] {
            let patch = TaskPatch {
                priority: Some(accepted.into()),
                ..Default::default()
            };
            let t = tasks::update_patch(&c, "t1", &patch, NOW).unwrap();
            assert_eq!(t.priority, accepted);
        }

        let later = TaskPatch {
            title: Some("改名".into()),
            ..Default::default()
        };
        let t = tasks::update_patch(&c, "t1", &later, NOW).unwrap();
        assert_eq!(t.priority, "low");
    }

    #[test]
    fn list_all_active_excludes_done_but_keeps_active_out_of_week() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "一", NOW, "t1").unwrap();
        week::capture(&c, "二", NOW, "t2").unwrap();
        week::capture(&c, "三", NOW, "t3").unwrap();
        week::capture(&c, "四", NOW, "t4").unwrap();
        tasks::set_status(&c, "t2", "done", NOW).unwrap();
        week::resolve(
            &c,
            "t3",
            crate::services::week::PassAction::Cancel,
            None,
            None,
            NOW,
        )
        .unwrap();
        crate::repo::tasks::archive(&c, "t4", NOW).unwrap();

        let ids: Vec<String> = crate::repo::tasks::list_all_active(&c)
            .unwrap()
            .into_iter()
            .map(|t| t.id)
            .collect();
        assert_eq!(ids, vec!["t1"]);
    }

    #[test]
    fn task_list_keeps_the_name_of_an_archived_project() {
        let c = db::open_in_memory().unwrap();
        seed_project(&c, "p1");
        week::capture(&c, "交底", NOW, "t1").unwrap();
        c.execute("UPDATE tasks SET project_id='p1' WHERE id='t1'", [])
            .unwrap();
        crate::repo::projects::set_archived(&c, "p1", true, NOW).unwrap();

        let task = crate::repo::tasks::list_all_active(&c).unwrap().remove(0);
        assert_eq!(task.project_name.as_deref(), Some("p1"));
    }

    #[test]
    fn a_status_change_keeps_a_suspended_task_out_of_the_week() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        week::resolve(
            &c,
            "t1",
            crate::services::week::PassAction::Suspend,
            Some("2026-11-02"),
            Some("等甲方"),
            NOW,
        )
        .unwrap();

        let t = tasks::set_status(&c, "t1", "doing", NOW).unwrap();

        assert!(!t.in_week);
        assert!(t.suspended);
        assert_eq!(t.suspended_until.as_deref(), Some("2026-11-02"));
        assert_eq!(t.suspend_reason.as_deref(), Some("等甲方"));
        assert_eq!(week::list_suspended(&c).unwrap().len(), 1);
    }

    #[test]
    fn completing_a_suspended_task_drops_the_suspension() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        week::resolve(
            &c,
            "t1",
            crate::services::week::PassAction::Suspend,
            Some("2026-11-02"),
            Some("等甲方"),
            NOW,
        )
        .unwrap();

        let t = tasks::set_status(&c, "t1", "done", NOW).unwrap();

        assert!(!t.suspended);
        assert!(t.suspended_until.is_none());
        assert!(t.suspended_at.is_none());
        assert!(t.suspend_reason.is_none());
        assert!(week::list_suspended(&c).unwrap().is_empty());
    }

    #[test]
    fn a_legacy_suspended_row_stays_out_of_the_week() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        // The old build could save in_week = 1 together with a suspension date.
        c.execute(
            "UPDATE tasks SET in_week = 1, suspended = 1, suspended_until = '2026-11-02'
             WHERE id = 't1'",
            [],
        )
        .unwrap();

        assert!(week::list(&c).unwrap().is_empty());
        assert!(week::pass_queue(&c).unwrap().is_empty());
        assert_eq!(week::list_suspended(&c).unwrap().len(), 1);

        let t = tasks::set_status(&c, "t1", "doing", NOW).unwrap();
        assert!(!t.in_week);
    }

    #[test]
    fn invalid_status_is_rejected() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        assert_eq!(
            tasks::set_status(&c, "t1", "archived", NOW).unwrap_err(),
            "invalid_status"
        );
    }

    fn start_task(c: &Connection) {
        tasks::set_status(c, "t1", "doing", NOW).unwrap();
    }

    #[test]
    fn an_edited_actual_finish_derives_the_effort_and_completes() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        start_task(&c);

        let patch = TaskPatch {
            actual_finish_at: Some(Some("2026-10-20T10:30:00Z".into())),
            ..Default::default()
        };
        let t = tasks::update_patch(&c, "t1", &patch, NOW).unwrap();

        assert_eq!(t.actual_effort_minutes, Some(150));
        assert_eq!(t.status, "done");
        assert!(!t.in_week);
    }

    #[test]
    fn an_edited_actual_effort_moves_the_actual_finish() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        start_task(&c);

        let patch = TaskPatch {
            actual_effort_minutes: Some(Some(90)),
            ..Default::default()
        };
        let t = tasks::update_patch(&c, "t1", &patch, NOW).unwrap();

        assert_eq!(t.actual_finish_at.as_deref(), Some("2026-10-20T09:30:00Z"));
        assert_eq!(t.status, "done");
        assert!(!t.in_week);
    }

    #[test]
    fn an_actual_finish_with_open_steps_is_rejected() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        start_task(&c);
        crate::services::steps::add(&c, "t1", "收集清单", NOW).unwrap();

        let patch = TaskPatch {
            actual_finish_at: Some(Some("2026-10-20T10:30:00Z".into())),
            ..Default::default()
        };
        assert_eq!(
            tasks::update_patch(&c, "t1", &patch, NOW).unwrap_err(),
            "steps_open"
        );
    }

    #[test]
    fn an_actual_effort_with_open_steps_is_rejected() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        start_task(&c);
        crate::services::steps::add(&c, "t1", "收集清单", NOW).unwrap();

        let patch = TaskPatch {
            actual_effort_minutes: Some(Some(90)),
            ..Default::default()
        };
        assert_eq!(
            tasks::update_patch(&c, "t1", &patch, NOW).unwrap_err(),
            "steps_open"
        );
    }

    #[test]
    fn an_actual_finish_without_a_start_is_rejected() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();

        let patch = TaskPatch {
            actual_finish_at: Some(Some("2026-10-20T10:30:00Z".into())),
            ..Default::default()
        };
        assert_eq!(
            tasks::update_patch(&c, "t1", &patch, NOW).unwrap_err(),
            "actual_start_required"
        );
    }

    #[test]
    fn actual_effort_without_a_start_is_rejected() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();

        let patch = TaskPatch {
            actual_effort_minutes: Some(Some(90)),
            ..Default::default()
        };
        assert_eq!(
            tasks::update_patch(&c, "t1", &patch, NOW).unwrap_err(),
            "actual_start_required"
        );
    }

    #[test]
    fn clearing_an_actual_finish_without_a_start_is_allowed() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        tasks::set_status(&c, "t1", "done", NOW).unwrap();

        let patch = TaskPatch {
            actual_finish_at: Some(None),
            ..Default::default()
        };
        let t = tasks::update_patch(&c, "t1", &patch, NOW).unwrap();

        assert!(t.actual_finish_at.is_none());
        assert!(t.actual_effort_minutes.is_none());
        assert_eq!(t.status, "doing");
    }

    #[test]
    fn an_actual_finish_before_the_start_is_rejected() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        start_task(&c);

        let patch = TaskPatch {
            actual_finish_at: Some(Some("2026-10-20T07:00:00Z".into())),
            ..Default::default()
        };
        assert_eq!(
            tasks::update_patch(&c, "t1", &patch, NOW).unwrap_err(),
            "finish_before_start"
        );
    }

    #[test]
    fn clearing_the_actual_finish_reopens_the_task() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        start_task(&c);
        tasks::set_status(&c, "t1", "done", "2026-10-20T10:30:00Z").unwrap();

        let patch = TaskPatch {
            actual_finish_at: Some(None),
            ..Default::default()
        };
        let t = tasks::update_patch(&c, "t1", &patch, NOW).unwrap();

        assert_eq!(t.status, "doing");
        assert!(t.in_week);
        assert!(t.actual_finish_at.is_none());
        assert!(t.actual_effort_minutes.is_none());
        assert_eq!(t.actual_start_at.as_deref(), Some(NOW));
    }

    #[test]
    fn a_manual_actual_start_moves_a_todo_task_to_doing() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();

        let patch = TaskPatch {
            actual_start_at: Some(Some("2026-10-20T07:00:00Z".into())),
            ..Default::default()
        };
        let t = tasks::update_patch(&c, "t1", &patch, NOW).unwrap();

        assert_eq!(t.status, "doing");
        assert_eq!(t.actual_start_at.as_deref(), Some("2026-10-20T07:00:00Z"));
        assert!(t.in_week);
    }

    #[test]
    fn clearing_the_actual_start_keeps_the_finish() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        start_task(&c);
        tasks::set_status(&c, "t1", "done", "2026-10-20T10:30:00Z").unwrap();

        let patch = TaskPatch {
            actual_start_at: Some(None),
            ..Default::default()
        };
        let t = tasks::update_patch(&c, "t1", &patch, NOW).unwrap();

        assert!(t.actual_start_at.is_none());
        assert_eq!(t.actual_finish_at.as_deref(), Some("2026-10-20T10:30:00Z"));
        assert_eq!(t.actual_effort_minutes, Some(150));
        assert_eq!(t.status, "done");
    }

    #[test]
    fn an_actual_start_and_finish_in_one_patch_are_allowed() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();

        let patch = TaskPatch {
            actual_start_at: Some(Some("2026-10-20T07:00:00Z".into())),
            actual_finish_at: Some(Some("2026-10-20T09:00:00Z".into())),
            ..Default::default()
        };
        let t = tasks::update_patch(&c, "t1", &patch, NOW).unwrap();

        assert_eq!(t.actual_effort_minutes, Some(120));
        assert_eq!(t.status, "done");
    }

    #[test]
    fn a_rejected_actual_finish_keeps_the_other_fields_untouched() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "原标题", NOW, "t1").unwrap();
        crate::services::steps::add(&c, "t1", "收集", NOW).unwrap();

        let patch = TaskPatch {
            title: Some("新标题".into()),
            actual_finish_at: Some(Some("2026-10-20T10:00:00Z".into())),
            ..Default::default()
        };
        assert_eq!(
            tasks::update_patch(&c, "t1", &patch, NOW).unwrap_err(),
            "steps_open"
        );

        let after = crate::repo::tasks::dto(&c, "t1").unwrap();
        assert_eq!(after.title, "原标题", "nothing may be written on a rejected save");
        assert!(after.actual_finish_at.is_none());
    }

    #[test]
    fn a_finish_without_a_start_writes_nothing() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "原标题", NOW, "t1").unwrap();

        let patch = TaskPatch {
            title: Some("新标题".into()),
            actual_finish_at: Some(Some("2026-10-20T10:00:00Z".into())),
            ..Default::default()
        };
        assert_eq!(
            tasks::update_patch(&c, "t1", &patch, NOW).unwrap_err(),
            "actual_start_required"
        );

        let after = crate::repo::tasks::dto(&c, "t1").unwrap();
        assert_eq!(after.title, "原标题");
        assert!(after.actual_finish_at.is_none());
    }

    #[test]
    fn a_picked_finish_and_a_rejected_actual_time_leave_no_delay_record() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();

        let patch = TaskPatch {
            expected_finish_date: Some(Some("2026-10-23".into())),
            actual_finish_at: Some(Some("2026-10-20T10:00:00Z".into())),
            ..Default::default()
        };
        assert_eq!(
            tasks::update_patch(&c, "t1", &patch, NOW).unwrap_err(),
            "actual_start_required"
        );

        let after = crate::repo::tasks::dto(&c, "t1").unwrap();
        assert_ne!(after.expected_finish_date.as_deref(), Some("2026-10-23"));
        assert!(after.delays.is_empty());
    }
}
