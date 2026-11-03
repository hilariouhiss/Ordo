use crate::dto::TaskDto;
use crate::repo::{steps, tasks};
use crate::services::status::derive;
use crate::services::tasks::valid_effort;
use rusqlite::Connection;
use uuid::Uuid;

pub fn add(
    conn: &Connection,
    task_id: &str,
    title: &str,
    now: &str,
) -> Result<TaskDto, String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("empty_step".into());
    }
    let sort = steps::next_sort(conn, task_id).map_err(|e| e.to_string())?;
    steps::insert(
        conn,
        &Uuid::new_v4().to_string(),
        task_id,
        title,
        sort,
        now,
    )
    .map_err(|e| e.to_string())?;
    recompute(conn, task_id, now)
}

pub fn toggle(conn: &Connection, step_id: &str, now: &str) -> Result<TaskDto, String> {
    let step = steps::get(conn, step_id).map_err(|e| e.to_string())?;
    steps::set_done(conn, step_id, !step.done, now).map_err(|e| e.to_string())?;
    recompute(conn, &step.task_id, now)
}

pub fn remove(conn: &Connection, step_id: &str, now: &str) -> Result<TaskDto, String> {
    let step = steps::get(conn, step_id).map_err(|e| e.to_string())?;
    steps::soft_delete(conn, step_id, now).map_err(|e| e.to_string())?;
    recompute(conn, &step.task_id, now)
}

/// Pins one step to a share of the task's effort; `None` returns it to the automatic split.
pub fn set_effort(
    conn: &Connection,
    step_id: &str,
    minutes: Option<i64>,
    now: &str,
) -> Result<TaskDto, String> {
    if let Some(minutes) = minutes {
        if !valid_effort(minutes) {
            return Err("invalid_effort".into());
        }
    }
    let step = steps::get(conn, step_id).map_err(|e| e.to_string())?;
    let current = steps::manual_effort_sum(conn, &step.task_id).map_err(|e| e.to_string())?;
    let next = current - step.effort_minutes.unwrap_or(0) + minutes.unwrap_or(0);
    if next > 28800 {
        return Err("steps_too_long".into());
    }

    steps::set_effort(conn, step_id, minutes, now).map_err(|e| e.to_string())?;

    // A share that no longer fits the estimate raises the estimate instead of being
    // rejected; clearing shares never lowers it again.
    let task = tasks::dto(conn, &step.task_id).map_err(|e| e.to_string())?;
    if next > task.effort_minutes {
        let patch = crate::dto::TaskPatch {
            effort_minutes: Some(next),
            ..Default::default()
        };
        crate::services::tasks::update_patch(conn, &step.task_id, &patch, now)?;
    }

    recompute(conn, &step.task_id, now)
}

pub fn reset_efforts(conn: &Connection, task_id: &str, now: &str) -> Result<TaskDto, String> {
    steps::clear_efforts(conn, task_id, now).map_err(|e| e.to_string())?;
    recompute(conn, task_id, now)
}

pub(crate) fn recompute(conn: &Connection, task_id: &str, now: &str) -> Result<TaskDto, String> {
    let stored = tasks::stored_status(conn, task_id).map_err(|e| e.to_string())?;
    let done_flags: Vec<bool> = steps::list(conn, task_id)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|s| s.done)
        .collect();
    let status = derive(&stored, &done_flags);
    tasks::set_status(conn, task_id, status, status == "done", now)
        .map_err(|e| e.to_string())?;
    tasks::dto(conn, task_id).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use rusqlite::Connection;

    const NOW: &str = "2026-10-20T08:00:00Z";

    fn with_task() -> Connection {
        let c = db::open_in_memory().unwrap();
        crate::services::week::capture(&c, "写方案", NOW, "t1").unwrap();
        c
    }

    #[test]
    fn a_new_step_starts_automatic() {
        let c = with_task();
        let task = add(&c, "t1", "收集需求", NOW).unwrap();

        assert_eq!(task.steps[0].effort_minutes, None);
    }

    #[test]
    fn sets_and_clears_a_manual_share() {
        let c = with_task();
        let task = add(&c, "t1", "收集需求", NOW).unwrap();
        let step_id = task.steps[0].id.clone();

        let task = set_effort(&c, &step_id, Some(90), NOW).unwrap();
        assert_eq!(task.steps[0].effort_minutes, Some(90));

        let task = set_effort(&c, &step_id, None, NOW).unwrap();
        assert_eq!(task.steps[0].effort_minutes, None);
    }

    #[test]
    fn resetting_returns_every_step_to_automatic() {
        let c = with_task();
        add(&c, "t1", "第一步", NOW).unwrap();
        let task = add(&c, "t1", "第二步", NOW).unwrap();
        let one = task.steps[0].id.clone();
        let two = task.steps[1].id.clone();
        set_effort(&c, &one, Some(30), NOW).unwrap();
        set_effort(&c, &two, Some(60), NOW).unwrap();

        let task = reset_efforts(&c, "t1", NOW).unwrap();

        assert!(task.steps.iter().all(|step| step.effort_minutes.is_none()));
    }

    #[test]
    fn rejects_a_share_outside_the_effort_range() {
        let c = with_task();
        let task = add(&c, "t1", "收集需求", NOW).unwrap();
        let step_id = task.steps[0].id.clone();

        for bad in [-1, 0, 28801] {
            assert_eq!(
                set_effort(&c, &step_id, Some(bad), NOW).unwrap_err(),
                "invalid_effort"
            );
        }
    }

    #[test]
    fn a_manual_share_above_the_estimate_raises_it() {
        let c = with_task();
        let task = add(&c, "t1", "收集需求", NOW).unwrap();
        let step_id = task.steps[0].id.clone();

        let task = set_effort(&c, &step_id, Some(600), NOW).unwrap();

        assert_eq!(task.effort_minutes, 600);
        assert_eq!(task.steps[0].effort_minutes, Some(600));
    }

    #[test]
    fn a_sum_above_the_task_limit_is_rejected() {
        let c = with_task();
        add(&c, "t1", "第一步", NOW).unwrap();
        let task = add(&c, "t1", "第二步", NOW).unwrap();
        let first = task.steps[0].id.clone();
        let second = task.steps[1].id.clone();
        let task = set_effort(&c, &first, Some(28800), NOW).unwrap();
        assert_eq!(task.effort_minutes, 28800);

        assert_eq!(
            set_effort(&c, &second, Some(1), NOW).unwrap_err(),
            "steps_too_long"
        );
        let task = tasks::dto(&c, "t1").unwrap();
        assert_eq!(task.effort_minutes, 28800);
        assert_eq!(task.steps[1].effort_minutes, None);
    }

    #[test]
    fn lowering_the_estimate_below_the_steps_is_rejected() {
        let c = with_task();
        let task = add(&c, "t1", "收集需求", NOW).unwrap();
        let step_id = task.steps[0].id.clone();
        set_effort(&c, &step_id, Some(600), NOW).unwrap();
        let patch = crate::dto::TaskPatch {
            effort_minutes: Some(480),
            ..Default::default()
        };

        assert_eq!(
            crate::services::tasks::update_patch(&c, "t1", &patch, NOW).unwrap_err(),
            "steps_over_effort"
        );
        let task = tasks::dto(&c, "t1").unwrap();
        assert_eq!(task.effort_minutes, 600);
    }

    #[test]
    fn resetting_keeps_a_raised_estimate() {
        let c = with_task();
        let task = add(&c, "t1", "收集需求", NOW).unwrap();
        let step_id = task.steps[0].id.clone();
        set_effort(&c, &step_id, Some(600), NOW).unwrap();

        let task = reset_efforts(&c, "t1", NOW).unwrap();

        assert_eq!(task.effort_minutes, 600);
        assert_eq!(task.steps[0].effort_minutes, None);
    }
}

