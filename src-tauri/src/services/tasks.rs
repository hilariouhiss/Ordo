use crate::dto::TaskDto;
use rusqlite::Connection;

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
    use crate::services::{tasks, week};

    const NOW: &str = "2026-10-20T08:00:00Z";

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
    fn update_fields_replaces_tags() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        let fields = crate::dto::TaskFields {
            title: "交底".into(),
            project_id: None,
            category_id: None,
            owner_id: None,
            start_date: None,
            due_date: None,
            note: None,
            tags: vec!["fix".into(), "交付".into()],
        };
        crate::repo::tasks::update_fields(&c, "t1", &fields, NOW).unwrap();
        let names: Vec<String> = crate::repo::tasks::dto(&c, "t1")
            .unwrap()
            .tags
            .into_iter()
            .map(|t| t.name)
            .collect();
        assert_eq!(names, vec!["fix", "交付"]);

        let mut second = fields;
        second.tags = vec!["fix".into()];
        crate::repo::tasks::update_fields(&c, "t1", &second, NOW).unwrap();
        let names: Vec<String> = crate::repo::tasks::dto(&c, "t1")
            .unwrap()
            .tags
            .into_iter()
            .map(|t| t.name)
            .collect();
        assert_eq!(names, vec!["fix"]);
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