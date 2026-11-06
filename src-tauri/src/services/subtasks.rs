use crate::dto::TaskDto;
use crate::repo::tasks;
use rusqlite::{params, Connection, OptionalExtension};

/// Minutes one task day holds.
const DEFAULT_EFFORT: i64 = 480;

/// Splits a flow's total across its steps: a hand-set share stays, the remainder divides
/// across the automatic ones with the pennies going to the earliest, never under a minute.
pub(crate) fn split_shares(parent_effort: i64, shares: &[Option<i64>]) -> Vec<i64> {
    let manual_total: i64 = shares.iter().flatten().sum();
    let auto_count = shares.iter().filter(|share| share.is_none()).count() as i64;
    let remaining = (parent_effort - manual_total).max(0);
    let base = if auto_count > 0 { remaining / auto_count } else { 0 };
    let mut extra = if auto_count > 0 { remaining % auto_count } else { 0 };
    shares
        .iter()
        .map(|share| match share {
            Some(minutes) => *minutes,
            None => {
                let minutes = base + if extra > 0 { extra -= 1; 1 } else { 0 };
                minutes.max(1)
            }
        })
        .collect()
}

/// The parent fields a new subtask inherits, so it starts out as the same kind of work.
struct ParentRow {
    parent_id: Option<String>,
    project_id: Option<String>,
    category_id: Option<String>,
    owner_id: Option<String>,
    priority: String,
    time_exclusive: i64,
    expected_start_date: Option<String>,
    expected_finish_date: Option<String>,
    suspended: i64,
    suspended_until: Option<String>,
    suspended_at: Option<String>,
    suspend_reason: Option<String>,
}

fn parent_row(conn: &Connection, id: &str) -> Result<ParentRow, String> {
    conn.query_row(
        "SELECT parent_id, project_id, category_id, owner_id, priority, time_exclusive,
                expected_start_date, expected_finish_date,
                suspended, suspended_until, suspended_at, suspend_reason
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
                expected_start_date: r.get(6)?,
                expected_finish_date: r.get(7)?,
                suspended: r.get(8)?,
                suspended_until: r.get(9)?,
                suspended_at: r.get(10)?,
                suspend_reason: r.get(11)?,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "task_not_found".to_string())
}

/// Adds a child task under a top-level one and refreshes the parent it now totals.
pub fn add(conn: &Connection, parent_id: &str, title: &str, now: &str) -> Result<TaskDto, String> {
    insert_child(conn, parent_id, title, DEFAULT_EFFORT, now)?;
    refresh(conn, parent_id, now)?;
    tasks::dto(conn, parent_id).map_err(|e| e.to_string())
}

/// Writes one child row. The caller owns the transaction and the rollup.
pub(crate) fn insert_child(
    conn: &Connection,
    parent_id: &str,
    title: &str,
    effort: i64,
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
    let id = uuid::Uuid::new_v4().to_string();
    // A parked umbrella parks its new child too, so the child cannot leak onto the week.
    let parked = parent.suspended == 1;
    conn.execute(
        "INSERT INTO tasks (id, title, parent_id, project_id, category_id, owner_id,
                            expected_start_date, expected_finish_date, status, in_week,
                            sort_order, effort_minutes, priority, time_exclusive,
                            suspended, suspended_until, suspended_at, suspend_reason,
                            created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'todo', ?9,
                 (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM tasks), ?10, ?11, ?12,
                 ?13, ?14, ?15, ?16, ?17, ?17)",
        params![
            id,
            title,
            parent_id,
            parent.project_id,
            parent.category_id,
            parent.owner_id,
            parent.expected_start_date,
            parent.expected_finish_date,
            if parked { 0 } else { 1 },
            effort,
            parent.priority,
            parent.time_exclusive,
            parent.suspended,
            parent.suspended_until,
            parent.suspended_at,
            parent.suspend_reason,
            now
        ],
    )
    .map_err(|e| e.to_string())?;
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
    conn.execute(
        "UPDATE tasks SET deleted_at = ?1, in_week = 0, updated_at = ?1 WHERE id = ?2",
        params![now, child_id],
    )
    .map_err(|e| e.to_string())?;
    refresh(conn, &parent, now)?;
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
    // Nothing left to add up: the task is an ordinary task again and keeps its own fields.
    if statuses.is_empty() {
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
    let stored: String = conn
        .query_row("SELECT status FROM tasks WHERE id = ?1", [parent_id], |r| {
            r.get(0)
        })
        .map_err(|e| e.to_string())?;
    let refs: Vec<&str> = statuses.iter().map(String::as_str).collect();
    let status = crate::services::status::derive(&stored, &refs);
    let done = status == "done";
    // The rollup writes the row directly: a derived date is not a reschedule the delay ledger
    // should record, and a rule keeps owning the clock time it generated.
    conn.execute(
        "UPDATE tasks SET effort_minutes = ?1,
                expected_start_date = ?2,
                expected_finish_date = ?3,
                started_at = COALESCE(?4, started_at),
                status = ?5,
                in_week = CASE WHEN ?6 THEN 0 WHEN suspended THEN 0 ELSE 1 END,
                suspended = CASE WHEN ?6 THEN 0 ELSE suspended END,
                suspended_until = CASE WHEN ?6 THEN NULL ELSE suspended_until END,
                suspended_at = CASE WHEN ?6 THEN NULL ELSE suspended_at END,
                suspend_reason = CASE WHEN ?6 THEN NULL ELSE suspend_reason END,
                actual_finish_at = CASE WHEN ?6 THEN COALESCE(?7, ?9) ELSE NULL END,
                actual_effort_minutes = CASE WHEN ?6 THEN ?8 ELSE NULL END,
                updated_at = ?9
         WHERE id = ?10",
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
            parent_id
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
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
        add(&c, "t1", "收集", NOW).unwrap();
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
    fn split_shares_gives_the_remainder_to_the_earliest() {
        assert_eq!(split_shares(480, &[None, None]), vec![240, 240]);
        assert_eq!(split_shares(100, &[None, None, None]), vec![34, 33, 33]);
        assert_eq!(split_shares(480, &[Some(90), None, None]), vec![90, 195, 195]);
    }
}
