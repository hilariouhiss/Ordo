use crate::dto::{SubtaskPlanDto, TaskDto};
use crate::repo::tasks;
use rusqlite::{params, Connection, OptionalExtension};

/// Splits a flow's total across its steps: a hand-set share stays, the remainder divides
/// across the automatic ones with the pennies going to the earliest, never under a minute.
pub(crate) fn split_shares(parent_effort: i64, shares: &[Option<i64>]) -> Vec<i64> {
    let manual_total: i64 = shares.iter().flatten().sum();
    let auto_count = shares.iter().filter(|share| share.is_none()).count() as i64;
    let remaining = (parent_effort - manual_total).max(0);
    let base = if auto_count > 0 { remaining / auto_count } else { 0 };
    let mut extra = if auto_count > 0 { remaining % auto_count } else { 0 };
    let mut shares: Vec<i64> = shares
        .iter()
        .map(|share| match share {
            Some(minutes) => *minutes,
            None => {
                let minutes = base + if extra > 0 { extra -= 1; 1 } else { 0 };
                minutes.max(1)
            }
        })
        .collect();
    // Hand shares alone cannot spend the whole estimate; the first child carries the rest,
    // so a migrated parent keeps the total it had.
    if auto_count == 0 {
        if let Some(first) = shares.first_mut() {
            *first += remaining;
        }
    }
    shares
}

/// The parent fields a new subtask inherits, so it starts out as the same kind of work.
struct ParentRow {
    parent_id: Option<String>,
    project_id: Option<String>,
    category_id: Option<String>,
    owner_id: Option<String>,
    priority: String,
    time_exclusive: i64,
    scope: String,
    expected_start_date: Option<String>,
    expected_finish_date: Option<String>,
    effort_minutes: i64,
    suspended: i64,
    suspended_until: Option<String>,
    suspended_at: Option<String>,
    suspend_reason: Option<String>,
    waiting: i64,
    waiting_on_id: Option<String>,
    follow_up_date: Option<String>,
    waiting_since: Option<String>,
}

fn parent_row(conn: &Connection, id: &str) -> Result<ParentRow, String> {
    conn.query_row(
        "SELECT parent_id, project_id, category_id, owner_id, priority, time_exclusive,
                scope, expected_start_date, expected_finish_date, effort_minutes,
                suspended, suspended_until, suspended_at, suspend_reason,
                waiting, waiting_on_id, follow_up_date, waiting_since
         FROM tasks
         WHERE id = ?1 AND deleted_at IS NULL AND archived_at IS NULL AND canceled_at IS NULL",
        [id],
        |r| {
            Ok(ParentRow {
                parent_id: r.get(0)?,
                project_id: r.get(1)?,
                category_id: r.get(2)?,
                owner_id: r.get(3)?,
                priority: r.get(4)?,
                time_exclusive: r.get(5)?,
                scope: r.get(6)?,
                expected_start_date: r.get(7)?,
                expected_finish_date: r.get(8)?,
                effort_minutes: r.get(9)?,
                suspended: r.get(10)?,
                suspended_until: r.get(11)?,
                suspended_at: r.get(12)?,
                suspend_reason: r.get(13)?,
                waiting: r.get(14)?,
                waiting_on_id: r.get(15)?,
                follow_up_date: r.get(16)?,
                waiting_since: r.get(17)?,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "task_not_found".to_string())
}

/// Where a new child's plan comes from: the sheet's draft, a template share, or the
/// previous live child (the default).
pub(crate) enum ChildPlan {
    Draft(SubtaskPlanDto),
    Effort(i64),
    Inherit,
}

/// Adds a child task under a top-level one and refreshes the parent it now totals.
pub fn add(conn: &Connection, parent_id: &str, title: &str, now: &str) -> Result<TaskDto, String> {
    add_with_plan(conn, parent_id, title, None, now)
}

/// Adds a child with the plan the sheet is showing; a missing plan inherits as before.
pub fn add_with_plan(
    conn: &Connection,
    parent_id: &str,
    title: &str,
    plan: Option<&SubtaskPlanDto>,
    now: &str,
) -> Result<TaskDto, String> {
    // One transaction: the child and the total it changes land together.
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let plan = plan.map_or(ChildPlan::Inherit, |plan| ChildPlan::Draft(plan.clone()));
    insert_child(&tx, parent_id, title, plan, now)?;
    refresh(&tx, parent_id, now)?;
    tx.commit().map_err(|e| e.to_string())?;
    tasks::dto(conn, parent_id).map_err(|e| e.to_string())
}

/// The last live subtask's plan: a new child continues from it, or from the parent when
/// this is the first one.
fn previous_child_plan(
    conn: &Connection,
    parent_id: &str,
) -> Result<Option<(i64, Option<String>)>, String> {
    conn.query_row(
        "SELECT effort_minutes, expected_finish_date
         FROM tasks
         WHERE parent_id = ?1 AND deleted_at IS NULL
           AND archived_at IS NULL AND canceled_at IS NULL
         ORDER BY sort_order DESC, id DESC
         LIMIT 1",
        [parent_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .optional()
    .map_err(|e| e.to_string())
}

/// Writes one child row. The caller owns the transaction and the rollup.
pub(crate) fn insert_child(
    conn: &Connection,
    parent_id: &str,
    title: &str,
    plan: ChildPlan,
    now: &str,
) -> Result<String, String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("empty_subtask_title".into());
    }
    let parent = parent_row(conn, parent_id)?;
    // One level only: a child cannot carry children of its own.
    if parent.parent_id.is_some() {
        return Err("nesting_too_deep".into());
    }
    // A drafted plan wins; otherwise the child continues the plan it was split from: the
    // previous live child, or the parent's own plan for the first one. A template's
    // explicit share fixes the estimate.
    let (start, finish, effort) = match plan {
        ChildPlan::Draft(plan) => {
            if !crate::services::tasks::valid_effort(plan.effort_minutes) {
                return Err("invalid_effort".into());
            }
            let start = plan
                .expected_start_date
                .as_deref()
                .map(|day| chrono::NaiveDate::parse_from_str(day, "%Y-%m-%d"))
                .transpose()
                .map_err(|_| "invalid_start_date")?;
            let finish = plan
                .expected_finish_date
                .as_deref()
                .map(|day| chrono::NaiveDate::parse_from_str(day, "%Y-%m-%d"))
                .transpose()
                .map_err(|_| "invalid_finish_date")?;
            // The sheet can send a start it just moved past the previous child's finish;
            // a span that ends before it starts would poison every plan and rollup.
            let (start, finish) = match (start, finish) {
                (Some(start), Some(finish)) if finish < start => (
                    Some(start),
                    Some(crate::services::timing::finish_for(
                        crate::services::timing::workday_on_or_after(start),
                        plan.effort_minutes,
                    )),
                ),
                pair => pair,
            };
            let day = |date: Option<chrono::NaiveDate>| {
                date.map(|day| day.format("%Y-%m-%d").to_string())
            };
            (day(start), day(finish), plan.effort_minutes)
        }
        plan => {
            let previous = previous_child_plan(conn, parent_id)?;
            let finish = previous
                .as_ref()
                .map_or(parent.expected_finish_date.clone(), |(_, day)| day.clone());
            let effort = match plan {
                ChildPlan::Effort(minutes) => minutes,
                _ => previous
                    .as_ref()
                    .map_or(parent.effort_minutes, |(minutes, _)| *minutes),
            };
            (parent.expected_start_date.clone(), finish, effort)
        }
    };
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO tasks (id, title, parent_id, project_id, category_id, owner_id,
                            expected_start_date, expected_finish_date, status,
                            sort_order, effort_minutes, priority, time_exclusive, scope,
                            created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'todo',
                 (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM tasks), ?9, ?10, ?11, ?12,
                 ?13, ?13)",
        params![
            id,
            title,
            parent_id,
            parent.project_id,
            parent.category_id,
            parent.owner_id,
            start,
            finish,
            effort,
            parent.priority,
            parent.time_exclusive,
            parent.scope,
            now
        ],
    )
    .map_err(|e| e.to_string())?;
    // A parked umbrella parks its new child too, so the child cannot leak onto the week.
    let park = match (parent.waiting, parent.suspended) {
        (1, _) => tasks::Park::Waiting {
            on: parent.waiting_on_id.as_deref(),
            follow_up: parent.follow_up_date.as_deref(),
            since: parent.waiting_since.as_deref(),
        },
        (0, 1) => tasks::Park::Suspended {
            until: parent.suspended_until.as_deref(),
            reason: parent.suspend_reason.as_deref(),
            at: parent.suspended_at.as_deref(),
        },
        _ => tasks::Park::InWeek,
    };
    tasks::write_park_in(conn, &id, park, now, false).map_err(|e| e.to_string())?;
    Ok(id)
}

/// Drops a subtask and refreshes the parent it belonged to.
pub fn remove(conn: &Connection, child_id: &str, now: &str) -> Result<TaskDto, String> {
    let parent = conn
        .query_row(
            "SELECT parent_id FROM tasks WHERE id = ?1 AND deleted_at IS NULL",
            [child_id],
            |r| r.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .flatten()
        .ok_or_else(|| "task_not_found".to_string())?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE tasks SET deleted_at = ?1, in_week = 0, updated_at = ?1 WHERE id = ?2",
        params![now, child_id],
    )
    .map_err(|e| e.to_string())?;
    // A reminder already fired for this child must not outlive the row it points at.
    tx.execute("DELETE FROM notifications WHERE task_id = ?1", [child_id])
        .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM reminder_snoozes WHERE task_id = ?1", [child_id])
        .map_err(|e| e.to_string())?;
    refresh(&tx, &parent, now)?;
    tx.commit().map_err(|e| e.to_string())?;
    tasks::dto(conn, &parent).map_err(|e| e.to_string())
}

/// After a change to one task, brings its parent back in line. One level only, so this
/// never climbs further than the parent.
pub(crate) fn sync_parent(conn: &Connection, task_id: &str, now: &str) -> Result<(), String> {
    let parent: Option<String> = conn
        .query_row("SELECT parent_id FROM tasks WHERE id = ?1", [task_id], |r| {
            r.get(0)
        })
        .map_err(|e| e.to_string())?;
    match parent {
        Some(parent) => refresh(conn, &parent, now),
        None => Ok(()),
    }
}

pub(crate) fn has_live_children(conn: &Connection, id: &str) -> Result<bool, String> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM tasks
                       WHERE parent_id = ?1 AND deleted_at IS NULL
                         AND archived_at IS NULL AND canceled_at IS NULL)",
        [id],
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}

/// A task's project is its work's project: moving the umbrella moves every child, so the
/// work is never left in another project (or another world). The caller owns the
/// transaction, so a refused later step undoes this too.
pub(crate) fn move_children_to_project(
    conn: &Connection,
    parent_id: &str,
    project_id: Option<&str>,
    now: &str,
) -> Result<(), String> {
    let changed = conn
        .execute(
            "UPDATE tasks SET project_id = ?1, updated_at = ?2
             WHERE parent_id = ?3 AND deleted_at IS NULL",
            params![project_id, now, parent_id],
        )
        .map_err(|e| e.to_string())?;
    let Some(project_id) = project_id.filter(|_| changed > 0) else {
        return Ok(());
    };
    conn.execute(
        "UPDATE tasks SET scope = (SELECT scope FROM projects WHERE id = ?1)
         WHERE parent_id = ?2 AND deleted_at IS NULL",
        params![project_id, parent_id],
    )
    .map_err(|e| e.to_string())?;
    let owners: Vec<String> = {
        let mut stmt = conn
            .prepare(
                "SELECT DISTINCT owner_id FROM tasks
                 WHERE parent_id = ?1 AND deleted_at IS NULL AND owner_id IS NOT NULL",
            )
            .map_err(|e| e.to_string())?;
        stmt.query_map([parent_id], |r| r.get(0))
            .map_err(|e| e.to_string())?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| e.to_string())?
    };
    for owner in owners {
        crate::services::projects::ensure_member(conn, Some(project_id), Some(&owner), now)?;
    }
    Ok(())
}

/// Rewrites the parent's derived fields from its live children. With no live child left the
/// parent keeps whatever it has and is an ordinary task again.
pub(crate) fn refresh(conn: &Connection, parent_id: &str, now: &str) -> Result<(), String> {
    let statuses: Vec<String> = {
        let mut stmt = conn
            .prepare(
                "SELECT status FROM tasks
                 WHERE parent_id = ?1 AND deleted_at IS NULL
                   AND archived_at IS NULL AND canceled_at IS NULL",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([parent_id], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| e.to_string())?
    };
    // Nothing left to add up: the task is an ordinary task again. Its status and actual
    // times came from children that are now gone, so they must not stay behind.
    if statuses.is_empty() {
        conn.execute(
            "UPDATE tasks SET status = 'todo',
                    in_week = CASE WHEN suspended THEN 0 WHEN waiting THEN 0 ELSE 1 END,
                    started_at = NULL, actual_finish_at = NULL,
                    actual_effort_minutes = NULL, updated_at = ?1
             WHERE id = ?2",
            params![now, parent_id],
        )
        .map_err(|e| e.to_string())?;
        return Ok(());
    }
    let (effort, start, finish, started, finished, actual): (
        i64,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        i64,
    ) = conn
        .query_row(
            "SELECT COALESCE(SUM(effort_minutes), 0),
                    MIN(expected_start_date), MAX(expected_finish_date),
                    MIN(started_at), MAX(actual_finish_at),
                    COALESCE(SUM(COALESCE(actual_effort_minutes, effort_minutes)), 0)
             FROM tasks
             WHERE parent_id = ?1 AND deleted_at IS NULL
               AND archived_at IS NULL AND canceled_at IS NULL",
            [parent_id],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?;
    let (stored, rule_owned): (String, bool) = conn
        .query_row(
            "SELECT status, rule_id IS NOT NULL FROM tasks WHERE id = ?1",
            [parent_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    let refs: Vec<&str> = statuses.iter().map(String::as_str).collect();
    let status = crate::services::status::derive(&stored, &refs);
    let done = status == "done";
    // The rollup writes the row directly: a derived date is not a reschedule the delay ledger
    // should record, and a rule keeps owning the clock time it generated. The parked columns
    // come from the one list in the repo, so a finished parent leaves every park together.
    conn.execute(
        &format!(
            "UPDATE tasks SET effort_minutes = ?1,
                expected_start_date = ?2,
                expected_finish_date = CASE WHEN ?11 THEN expected_finish_date ELSE ?3 END,
                started_at = ?4,
                status = ?5,
                in_week = CASE WHEN ?6 THEN 0 WHEN suspended THEN 0 WHEN waiting THEN 0 ELSE 1 END,
                {},
                actual_finish_at = CASE WHEN ?6 THEN COALESCE(?7, ?9) ELSE NULL END,
                actual_effort_minutes = CASE WHEN ?6 THEN ?8 ELSE NULL END,
                updated_at = ?9
         WHERE id = ?10",
            tasks::park_reset("?6")
        ),
        params![
            effort,
            start,
            finish,
            started,
            status,
            done,
            finished,
            actual,
            now,
            parent_id,
            rule_owned
        ],
    )
    .map_err(|e| e.to_string())?;
    // An umbrella that just became done can be the last task of its requirement.
    if status == "done" && stored != "done" {
        crate::services::requirements::advance_for_task_in(conn, parent_id, now)?;
    }
    Ok(())
}

/// Saves the sheet's subtask order. Only the children trade their existing sort slots, so
/// an unrelated task never moves around them.
pub fn reorder(conn: &Connection, parent_id: &str, ids: &[String]) -> Result<TaskDto, String> {
    if !tasks::exists(conn, parent_id).map_err(|e| e.to_string())? {
        return Err("task_not_found".into());
    }
    let rows: Vec<(String, i64)> = {
        let mut stmt = conn
            .prepare(
                "SELECT id, sort_order FROM tasks
                 WHERE parent_id = ?1 AND deleted_at IS NULL
                   AND archived_at IS NULL AND canceled_at IS NULL
                 ORDER BY sort_order, id",
            )
            .map_err(|e| e.to_string())?;
        let mapped = stmt
            .query_map([parent_id], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|e| e.to_string())?;
        mapped
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| e.to_string())?
    };
    let current: Vec<&str> = rows.iter().map(|(id, _)| id.as_str()).collect();
    let requested: Vec<&str> = ids.iter().map(String::as_str).collect();
    let mut current_sorted = current.clone();
    current_sorted.sort_unstable();
    let mut requested_sorted = requested.clone();
    requested_sorted.sort_unstable();
    if current_sorted != requested_sorted {
        return Err("subtasks_changed".into());
    }
    if current == requested {
        return tasks::dto(conn, parent_id).map_err(|e| e.to_string());
    }
    let mut slots: Vec<i64> = rows.iter().map(|(_, slot)| *slot).collect();
    slots.sort_unstable();
    let orders: Vec<(String, i64)> = ids.iter().cloned().zip(slots).collect();
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    crate::repo::tasks::write_orders_in(&tx, &orders).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    tasks::dto(conn, parent_id).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::dto::TaskPatch;
    use crate::services::{tasks, week};
    use rusqlite::Connection;

    const NOW: &str = "2026-10-20T08:00:00Z";
    const LATER: &str = "2026-10-21T09:00:00Z";

    fn with_task() -> Connection {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交付资料", NOW, "t1").unwrap();
        c
    }

    #[test]
    fn an_empty_subtask_title_is_rejected() {
        let c = with_task();

        assert_eq!(
            add(&c, "t1", "   ", NOW).unwrap_err(),
            "empty_subtask_title"
        );
    }

    #[test]
    fn a_subtask_is_a_full_task_on_the_week() {
        let c = with_task();
        let parent = add(&c, "t1", "收集清单", NOW).unwrap();

        let child = &parent.children[0];
        assert_eq!(child.title, "收集清单");
        assert_eq!(child.parent_id.as_deref(), Some("t1"));
        assert_eq!(child.parent_title.as_deref(), Some("交付资料"));
        assert_eq!(child.effort_minutes, 480);
        assert_eq!(child.status, "todo");
        // The week lists the work, never the umbrella.
        let ids: Vec<String> = week::list(&c).unwrap().into_iter().map(|t| t.id).collect();
        assert_eq!(ids, vec![child.id.clone()]);
    }

    #[test]
    fn the_parent_totals_its_children() {
        let c = with_task();
        add(&c, "t1", "收集清单", NOW).unwrap();
        let parent = add(&c, "t1", "汇编初稿", NOW).unwrap();

        let first = parent.children[0].id.clone();
        let second = parent.children[1].id.clone();
        tasks::update_patch(
            &c,
            &second,
            &TaskPatch {
                effort_minutes: Some(120),
                ..Default::default()
            },
            LATER,
        )
        .unwrap();
        tasks::update_patch(
            &c,
            &first,
            &TaskPatch {
                expected_finish_date: Some(Some("2026-10-26".to_string())),
                ..Default::default()
            },
            LATER,
        )
        .unwrap();
        tasks::set_status(&c, &first, "done", LATER).unwrap();

        let parent = crate::repo::tasks::dto(&c, "t1").unwrap();
        assert_eq!(parent.children.len(), 2);
        let total: i64 = parent.children.iter().map(|child| child.effort_minutes).sum();
        assert_eq!(parent.effort_minutes, total);
        assert_eq!(parent.expected_finish_date.as_deref(), Some("2026-10-26"));
        // One child finished is a task in progress, not a finished umbrella.
        assert_eq!(parent.status, "doing");
        assert!(parent.in_week);
    }

    #[test]
    fn a_rule_occurrence_keeps_its_own_day() {
        let c = db::open_in_memory().unwrap();
        // The rule made this occurrence; its day belongs to the rule, not to the children.
        c.execute_batch(
            "INSERT INTO task_rules (id, title, weekdays, at_time, effort_minutes,
                                     created_at, updated_at)
             VALUES ('r1', '周会', '[1]', '09:00', 480,
                     '2026-10-20T08:00:00Z', '2026-10-20T08:00:00Z');
             INSERT INTO tasks (id, title, expected_finish_date, expected_finish_time,
                                effort_minutes, rule_id, created_at, updated_at)
             VALUES ('p', '周会', '2026-10-20', '17:00', 480, 'r1',
                     '2026-10-20T08:00:00Z', '2026-10-20T08:00:00Z');",
        )
        .unwrap();
        let parent = add(&c, "p", "准备材料", NOW).unwrap();
        let child = parent.children[0].id.clone();

        tasks::update_patch(
            &c,
            &child,
            &TaskPatch {
                expected_finish_date: Some(Some("2026-10-23".to_string())),
                ..Default::default()
            },
            LATER,
        )
        .unwrap();

        let parent = crate::repo::tasks::dto(&c, "p").unwrap();
        assert_eq!(parent.expected_finish_date.as_deref(), Some("2026-10-20"));
        assert_eq!(
            parent.children[0].expected_finish_date.as_deref(),
            Some("2026-10-23"),
            "the child still owns its own day"
        );
    }

    #[test]
    fn a_nested_subtask_is_rejected() {
        let c = with_task();
        let parent = add(&c, "t1", "第一步", NOW).unwrap();
        let child = parent.children[0].id.clone();

        assert_eq!(
            add(&c, &child, "第二步", NOW).unwrap_err(),
            "nesting_too_deep"
        );
    }

    #[test]
    fn finishing_every_child_finishes_the_parent() {
        let c = with_task();
        let parent = add(&c, "t1", "收集清单", NOW).unwrap();
        let first = parent.children[0].id.clone();
        let parent = add(&c, "t1", "汇编初稿", NOW).unwrap();
        let second = parent.children[1].id.clone();

        tasks::set_status(&c, &first, "done", LATER).unwrap();
        let parent_task = tasks::set_status(&c, &second, "done", LATER).unwrap();
        assert_eq!(parent_task.status, "done");

        let parent = crate::repo::tasks::dto(&c, "t1").unwrap();
        assert_eq!(parent.status, "done");
        assert!(!parent.in_week);
        assert!(parent.actual_finish_at.is_some());
        assert_eq!(parent.actual_effort_minutes, Some(parent.effort_minutes));
        assert!(week::list(&c).unwrap().is_empty());
    }

    #[test]
    fn reopening_a_child_reopens_the_parent() {
        let c = with_task();
        let parent = add(&c, "t1", "收集清单", NOW).unwrap();
        let child = parent.children[0].id.clone();
        tasks::set_status(&c, &child, "done", LATER).unwrap();
        assert_eq!(
            crate::repo::tasks::dto(&c, "t1").unwrap().status,
            "done"
        );

        tasks::set_status(&c, &child, "doing", LATER).unwrap();

        let parent = crate::repo::tasks::dto(&c, "t1").unwrap();
        assert_eq!(parent.status, "doing");
        assert!(parent.in_week);
        assert!(parent.actual_finish_at.is_none());
        assert!(parent.actual_effort_minutes.is_none());
    }

    #[test]
    fn a_new_subtask_of_a_parked_umbrella_stays_parked() {
        let c = with_task();
        let first = add(&c, "t1", "收集", NOW).unwrap();
        let child = first.children[0].id.clone();
        week::start(&c, &child, NOW).unwrap();
        week::suspend(&c, "t1", Some("2026-11-02"), Some("等甲方"), NOW).unwrap();

        let parent = add(&c, "t1", "汇编", NOW).unwrap();

        let child = parent
            .children
            .iter()
            .find(|one| one.title == "汇编")
            .unwrap();
        assert!(child.suspended);
        assert!(!child.in_week);
        assert!(week::list(&c).unwrap().is_empty());
    }

    #[test]
    fn a_new_subtask_of_a_waiting_umbrella_waits_too() {
        let c = with_task();
        add(&c, "t1", "收集", NOW).unwrap();
        week::wait(&c, "t1", None, Some("2026-11-02"), NOW).unwrap();

        let parent = add(&c, "t1", "汇编", NOW).unwrap();

        let child = parent
            .children
            .iter()
            .find(|one| one.title == "汇编")
            .unwrap();
        assert!(child.waiting);
        assert!(!child.in_week);
        assert_eq!(child.follow_up_date.as_deref(), Some("2026-11-02"));
        assert!(week::list(&c).unwrap().is_empty());
    }

    #[test]
    fn a_rollup_keeps_a_waiting_parent_out_of_the_week() {
        let c = with_task();
        add(&c, "t1", "收集", NOW).unwrap();
        week::wait(&c, "t1", None, Some("2026-11-02"), NOW).unwrap();

        let parent = add(&c, "t1", "汇编", LATER).unwrap();

        assert!(parent.waiting);
        assert!(!parent.in_week);
    }

    #[test]
    fn finishing_the_last_child_clears_the_waiting_parent() {
        let c = with_task();
        let parent = add(&c, "t1", "收集", NOW).unwrap();
        let child = parent.children[0].id.clone();
        week::wait(&c, "t1", None, Some("2026-11-02"), NOW).unwrap();

        tasks::set_status(&c, &child, "done", LATER).unwrap();

        let parent = crate::repo::tasks::dto(&c, "t1").unwrap();
        assert_eq!(parent.status, "done");
        assert!(!parent.waiting);
        assert!(parent.follow_up_date.is_none());
        assert!(week::list_waiting(&c).unwrap().is_empty());
    }

    #[test]
    fn removing_a_child_lowers_the_total() {
        let c = with_task();
        let parent = add(&c, "t1", "收集清单", NOW).unwrap();
        let first = parent.children[0].id.clone();
        add(&c, "t1", "汇编初稿", NOW).unwrap();
        assert_eq!(
            crate::repo::tasks::dto(&c, "t1").unwrap().effort_minutes,
            960
        );

        let parent = remove(&c, &first, LATER).unwrap();

        assert_eq!(parent.children.len(), 1);
        assert_eq!(parent.effort_minutes, 480);
    }

    #[test]
    fn removing_a_child_drops_its_fired_reminders() {
        let c = with_task();
        let parent = add(&c, "t1", "收集清单", NOW).unwrap();
        let child = parent.children[0].id.clone();
        crate::repo::notifications::fire(
            &c,
            "n1",
            &child,
            "overdue",
            "2026-10-20",
            "2026-10-20T17:30:00Z",
            NOW,
        )
        .unwrap();
        crate::repo::snoozes::set(&c, &child, "2026-10-20T18:00:00Z").unwrap();

        remove(&c, &child, LATER).unwrap();

        let count = |table: &str| -> i64 {
            c.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
                .unwrap()
        };
        assert_eq!(count("notifications"), 0);
        assert_eq!(count("reminder_snoozes"), 0);
    }

    #[test]
    fn the_last_child_gone_returns_the_parent_to_manual_edits() {
        let c = with_task();
        let parent = add(&c, "t1", "收集清单", NOW).unwrap();
        let child = parent.children[0].id.clone();
        remove(&c, &child, LATER).unwrap();

        let patch = TaskPatch {
            effort_minutes: Some(180),
            ..Default::default()
        };
        let parent = tasks::update_patch(&c, "t1", &patch, LATER).unwrap();

        assert_eq!(parent.effort_minutes, 180);
        assert!(parent.children.is_empty());
    }

    #[test]
    fn the_parent_refuses_hand_edits_of_its_derived_fields() {
        let c = with_task();
        add(&c, "t1", "收集清单", NOW).unwrap();
        let patch = TaskPatch {
            effort_minutes: Some(60),
            ..Default::default()
        };

        assert_eq!(
            tasks::update_patch(&c, "t1", &patch, LATER).unwrap_err(),
            "parent_derived"
        );
        assert_eq!(
            tasks::set_status(&c, "t1", "done", LATER).unwrap_err(),
            "parent_derived"
        );
    }

    #[test]
    fn losing_the_last_started_child_clears_the_parent_rollup() {
        let c = with_task();
        let parent = add(&c, "t1", "收集清单", NOW).unwrap();
        let child = parent.children[0].id.clone();
        tasks::set_status(&c, &child, "doing", NOW).unwrap();

        remove(&c, &child, LATER).unwrap();

        let parent = crate::repo::tasks::dto(&c, "t1").unwrap();
        assert_eq!(parent.status, "todo");
        assert!(parent.actual_start_at.is_none());
        assert!(parent.actual_finish_at.is_none());
        assert!(parent.actual_effort_minutes.is_none());
        assert!(parent.in_week);
    }

    #[test]
    fn removing_one_started_child_leaves_the_parent_unstarted() {
        let c = with_task();
        let parent = add(&c, "t1", "收集清单", NOW).unwrap();
        let first = parent.children[0].id.clone();
        add(&c, "t1", "汇编初稿", NOW).unwrap();
        tasks::set_status(&c, &first, "doing", NOW).unwrap();
        assert!(crate::repo::tasks::dto(&c, "t1").unwrap().actual_start_at.is_some());

        remove(&c, &first, LATER).unwrap();

        let parent = crate::repo::tasks::dto(&c, "t1").unwrap();
        assert_eq!(parent.status, "todo");
        assert!(
            parent.actual_start_at.is_none(),
            "no live child has started, so the umbrella has not either"
        );
    }

    #[test]
    fn losing_the_last_finished_child_clears_the_phantom_completion() {
        let c = with_task();
        let parent = add(&c, "t1", "收集清单", NOW).unwrap();
        let child = parent.children[0].id.clone();
        tasks::set_status(&c, &child, "done", LATER).unwrap();
        assert_eq!(crate::repo::tasks::dto(&c, "t1").unwrap().status, "done");

        remove(&c, &child, LATER).unwrap();

        let parent = crate::repo::tasks::dto(&c, "t1").unwrap();
        assert_eq!(parent.status, "todo");
        assert!(parent.actual_finish_at.is_none());
        assert!(parent.actual_effort_minutes.is_none());
        assert!(parent.in_week);
    }

    #[test]
    fn cancelling_the_last_started_child_clears_the_parent_rollup() {
        let c = with_task();
        let parent = add(&c, "t1", "收集清单", NOW).unwrap();
        let child = parent.children[0].id.clone();
        tasks::set_status(&c, &child, "doing", NOW).unwrap();

        week::resolve(&c, &child, week::PassAction::Cancel, None, None, LATER).unwrap();

        let parent = crate::repo::tasks::dto(&c, "t1").unwrap();
        assert_eq!(parent.status, "todo");
        assert!(parent.actual_start_at.is_none());
        assert!(parent.in_week);
    }

    #[test]
    fn split_shares_gives_the_remainder_to_the_earliest() {
        assert_eq!(split_shares(480, &[None, None]), vec![240, 240]);
        assert_eq!(split_shares(100, &[None, None, None]), vec![34, 33, 33]);
        assert_eq!(split_shares(480, &[Some(90), None, None]), vec![90, 195, 195]);
        // Hand shares alone cannot spend the whole estimate; the first child carries it.
        assert_eq!(split_shares(480, &[Some(90), Some(90)]), vec![390, 90]);
    }

    #[test]
    fn a_first_subtask_inherits_the_parent_plan() {
        let c = with_task();
        tasks::update_patch(
            &c,
            "t1",
            &TaskPatch {
                expected_start_date: Some(Some("2026-10-21".into())),
                effort_minutes: Some(960),
                ..Default::default()
            },
            NOW,
        )
        .unwrap();
        let parent_before = crate::repo::tasks::dto(&c, "t1").unwrap();

        let parent = add(&c, "t1", "第一步", NOW).unwrap();
        let child = &parent.children[0];

        assert_eq!(child.expected_start_date, parent_before.expected_start_date);
        assert_eq!(child.effort_minutes, 960);
        assert_eq!(child.expected_finish_date, parent_before.expected_finish_date);
        assert_eq!(parent.effort_minutes, 960, "the first child must not double the plan");
    }

    #[test]
    fn a_first_subtask_takes_the_sheet_draft_plan() {
        let c = with_task();
        let plan = SubtaskPlanDto {
            expected_start_date: Some("2026-10-21".into()),
            expected_finish_date: Some("2026-10-22".into()),
            effort_minutes: 960,
        };

        let parent = add_with_plan(&c, "t1", "第一步", Some(&plan), NOW).unwrap();
        let child = &parent.children[0];

        assert_eq!(child.expected_start_date.as_deref(), Some("2026-10-21"));
        assert_eq!(child.expected_finish_date.as_deref(), Some("2026-10-22"));
        assert_eq!(child.effort_minutes, 960);
        assert_eq!(parent.effort_minutes, 960);
    }

    #[test]
    fn a_draft_subtask_plan_is_validated() {
        let c = with_task();
        let bad_effort = SubtaskPlanDto {
            expected_start_date: None,
            expected_finish_date: None,
            effort_minutes: 0,
        };
        assert_eq!(
            add_with_plan(&c, "t1", "第一步", Some(&bad_effort), NOW).unwrap_err(),
            "invalid_effort"
        );
        let bad_day = SubtaskPlanDto {
            expected_start_date: Some("2026-13-01".into()),
            expected_finish_date: None,
            effort_minutes: 480,
        };
        assert_eq!(
            add_with_plan(&c, "t1", "第一步", Some(&bad_day), NOW).unwrap_err(),
            "invalid_start_date"
        );
    }

    #[test]
    fn a_draft_plan_never_finishes_before_it_starts() {
        let c = with_task();
        let plan = SubtaskPlanDto {
            expected_start_date: Some("2026-11-02".into()),
            expected_finish_date: Some("2026-10-20".into()),
            effort_minutes: 480,
        };

        let parent = add_with_plan(&c, "t1", "第一步", Some(&plan), NOW).unwrap();
        let child = &parent.children[0];

        assert_eq!(child.expected_start_date.as_deref(), Some("2026-11-02"));
        assert_eq!(child.expected_finish_date.as_deref(), Some("2026-11-02"));
        assert_eq!(parent.expected_finish_date.as_deref(), Some("2026-11-02"));
    }

    #[test]
    fn a_later_subtask_copies_the_previous_hand_edited_plan() {
        let c = with_task();
        let parent = add(&c, "t1", "收集", NOW).unwrap();
        let first_id = parent.children[0].id.clone();
        tasks::update_patch(
            &c,
            &first_id,
            &TaskPatch {
                effort_minutes: Some(120),
                ..Default::default()
            },
            LATER,
        )
        .unwrap();
        let first = crate::repo::tasks::dto(&c, &first_id).unwrap();

        let parent = add(&c, "t1", "汇编", NOW).unwrap();
        let second = parent
            .children
            .iter()
            .find(|child| child.id != first_id)
            .unwrap();

        assert_eq!(second.effort_minutes, 120);
        assert_eq!(second.expected_finish_date, first.expected_finish_date);
        assert_eq!(
            crate::repo::tasks::dto(&c, &first_id).unwrap().effort_minutes,
            120,
            "a hand edit stays put"
        );
        assert_eq!(parent.effort_minutes, 240);
    }

    #[test]
    fn a_subtask_reorder_keeps_other_tasks_in_place() {
        let c = with_task();
        week::capture(&c, "别的事", NOW, "t2").unwrap();
        let parent = add(&c, "t1", "一", NOW).unwrap();
        let first = parent.children[0].id.clone();
        let parent = add(&c, "t1", "二", NOW).unwrap();
        let second = parent.children[1].id.clone();
        let parent = add(&c, "t1", "三", NOW).unwrap();
        let third = parent.children[2].id.clone();

        let parent = reorder(&c, "t1", &[third.clone(), first.clone(), second.clone()]).unwrap();

        let ids: Vec<&str> = parent.children.iter().map(|child| child.id.as_str()).collect();
        assert_eq!(ids, vec![third.as_str(), first.as_str(), second.as_str()]);
        // The unrelated task keeps its slot; the children only trade theirs.
        let other: i64 = c
            .query_row("SELECT sort_order FROM tasks WHERE id = 't2'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(other, 1);
    }

    #[test]
    fn a_subtask_reorder_rejects_a_stale_list() {
        let c = with_task();
        let parent = add(&c, "t1", "一", NOW).unwrap();
        let first = parent.children[0].id.clone();
        add(&c, "t1", "二", NOW).unwrap();

        assert_eq!(
            reorder(&c, "t1", std::slice::from_ref(&first)).unwrap_err(),
            "subtasks_changed"
        );
        assert_eq!(
            reorder(&c, "t1", &[first.clone(), first]).unwrap_err(),
            "subtasks_changed"
        );
        assert_eq!(reorder(&c, "nope", &[]).unwrap_err(), "task_not_found");
    }
}
