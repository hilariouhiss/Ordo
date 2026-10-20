use crate::dto::{TaskDto, TaskPatch};
use rusqlite::Connection;

pub fn update_patch(
    conn: &Connection,
    id: &str,
    patch: &TaskPatch,
    now: &str,
) -> Result<TaskDto, String> {
    crate::repo::tasks::apply_patch(conn, id, patch, now).map_err(|e| e.to_string())?;
    crate::repo::tasks::dto(conn, id).map_err(|e| e.to_string())
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