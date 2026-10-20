use crate::dto::{TaskDto, TaskPatch};
use rusqlite::Connection;

pub fn update_patch(
    conn: &Connection,
    id: &str,
    patch: &TaskPatch,
    now: &str,
) -> Result<TaskDto, String> {
    if let Some(effort) = patch.effort_days {
        if !effort.is_finite() || effort < 0.5 || effort > 60.0 || (effort * 2.0).fract() != 0.0 {
            return Err("invalid_effort".into());
        }
    }
    crate::repo::tasks::apply_patch(conn, id, patch, now).map_err(|e| e.to_string())?;
    crate::repo::tasks::dto(conn, id).map_err(|e| e.to_string())
}

/// Puts a task just before `before_id`, or last when there is no anchor.
pub fn move_task(conn: &Connection, task_id: &str, before_id: Option<&str>) -> Result<(), String> {
    let ids = crate::repo::tasks::ordered_ids(conn).map_err(|e| e.to_string())?;
    let from = ids
        .iter()
        .position(|id| id.as_str() == task_id)
        .ok_or("task_not_found")?;
    let mut rest = ids;
    rest.remove(from);
    let to = match before_id {
        Some(before) if before == task_id => return Ok(()),
        Some(before) => rest
            .iter()
            .position(|id| id.as_str() == before)
            .ok_or("task_not_found")?,
        None => rest.len(),
    };
    if to == from {
        return Ok(());
    }
    rest.insert(to, task_id.to_owned());
    crate::repo::tasks::write_orders(conn, &rest).map_err(|e| e.to_string())
}

pub fn set_status(conn: &Connection, id: &str, status: &str, now: &str) -> Result<TaskDto, String> {
    if !["todo", "doing", "done"].contains(&status) {
        return Err("invalid_status".into());
    }
    let done = status == "done";
    crate::repo::tasks::set_status(conn, id, status, done, now).map_err(|e| e.to_string())?;
    crate::repo::tasks::dto(conn, id).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use crate::db;
    use crate::dto::TaskPatch;
    use crate::services::{tasks, week};
    use rusqlite::Connection;

    const NOW: &str = "2026-10-20T08:00:00Z";

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

    #[test]
    fn a_due_date_in_the_payload_cannot_skip_the_reschedule_record() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        c.execute(
            "UPDATE tasks SET due_date = '2026-10-25' WHERE id = 't1'",
            [],
        )
        .unwrap();
        // Due dates only move through set_due, which writes the delay record.
        let patch: TaskPatch = serde_json::from_str(r#"{"dueDate":"2026-12-01"}"#).unwrap();
        let t = tasks::update_patch(&c, "t1", &patch, NOW).unwrap();
        assert_eq!(t.due_date.as_deref(), Some("2026-10-25"));
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
        let done_at: Option<String> = c
            .query_row("SELECT done_at FROM tasks WHERE id='t1'", [], |r| r.get(0))
            .unwrap();
        assert!(done_at.is_none());
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
        crate::repo::tasks::ordered_ids(c).unwrap()
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
            effort_days: Some(0.25),
            ..Default::default()
        };
        assert_eq!(
            tasks::update_patch(&c, "t1", &bad, NOW).unwrap_err(),
            "invalid_effort"
        );

        let patch = TaskPatch {
            title: Some("改名".into()),
            effort_days: Some(2.5),
            ..Default::default()
        };
        let t = tasks::update_patch(&c, "t1", &patch, NOW).unwrap();
        assert_eq!(t.title, "改名");
        assert_eq!(t.effort_days, 2.5);

        let later = TaskPatch {
            title: Some("再改".into()),
            ..Default::default()
        };
        let t = tasks::update_patch(&c, "t1", &later, NOW).unwrap();
        assert_eq!(t.effort_days, 2.5);

        for accepted in [0.5, 60.0] {
            let patch = TaskPatch {
                effort_days: Some(accepted),
                ..Default::default()
            };
            let t = tasks::update_patch(&c, "t1", &patch, NOW).unwrap();
            assert_eq!(t.effort_days, accepted);
        }
        for rejected in [0.25, 60.5, f64::NAN, f64::INFINITY] {
            let patch = TaskPatch {
                effort_days: Some(rejected),
                ..Default::default()
            };
            assert_eq!(
                tasks::update_patch(&c, "t1", &patch, NOW).unwrap_err(),
                "invalid_effort"
            );
        }
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
}