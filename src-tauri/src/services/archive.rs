use crate::dto::{ArchiveDto, TaskDto};
use crate::repo::{projects, tasks};
use rusqlite::Connection;

pub fn list(conn: &Connection, query: Option<&str>) -> Result<ArchiveDto, String> {
    Ok(ArchiveDto {
        projects: projects::list_archived(conn, query).map_err(|e| e.to_string())?,
        tasks: tasks::list_archived(conn, query).map_err(|e| e.to_string())?,
        canceled: tasks::list_canceled(conn, query).map_err(|e| e.to_string())?,
        done: tasks::list_done(conn, query).map_err(|e| e.to_string())?,
    })
}

pub fn restore_task(conn: &Connection, id: &str, now: &str) -> Result<TaskDto, String> {
    tasks::restore(conn, id, now).map_err(|e| e.to_string())?;
    tasks::dto(conn, id).map_err(|e| e.to_string())
}

pub fn delete_task(conn: &Connection, id: &str) -> Result<(), String> {
    let row = conn.query_row(
        "SELECT archived_at, canceled_at FROM tasks WHERE id = ?1",
        [id],
        |r| {
            Ok((
                r.get::<_, Option<String>>(0)?,
                r.get::<_, Option<String>>(1)?,
            ))
        },
    );
    match row {
        // Deleting is the last step: an active task has to be archived (or canceled) first.
        Ok((archived, canceled)) if archived.is_none() && canceled.is_none() => {
            Err("task_not_archived".into())
        }
        Ok(_) => tasks::delete(conn, id).map_err(|e| e.to_string()),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use crate::db;
    use crate::services::{archive, week};

    const NOW: &str = "2026-10-20T08:00:00Z";

    #[test]
    fn restore_puts_task_back_in_week() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        crate::repo::tasks::archive(&c, "t1", NOW).unwrap();
        assert!(week::list(&c).unwrap().is_empty());

        let t = archive::restore_task(&c, "t1", NOW).unwrap();
        assert!(t.in_week);
        assert!(t.archived_at.is_none());
    }

    #[test]
    fn restored_task_appends_to_the_end() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "一", NOW, "t1").unwrap();
        week::capture(&c, "二", NOW, "t2").unwrap();
        crate::repo::tasks::archive(&c, "t1", NOW).unwrap();

        archive::restore_task(&c, "t1", NOW).unwrap();

        let ids: Vec<String> = week::list(&c).unwrap().into_iter().map(|t| t.id).collect();
        assert_eq!(ids, vec!["t2", "t1"]);
    }

    #[test]
    fn delete_cascades_steps_and_delays() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        crate::services::steps::add(&c, "t1", "一步", NOW).unwrap();
        crate::services::deliverables::add_note(&c, "t1", "等回复", NOW).unwrap();
        crate::repo::tasks::archive(&c, "t1", NOW).unwrap();

        archive::delete_task(&c, "t1").unwrap();
        let steps: i64 = c
            .query_row("SELECT COUNT(*) FROM steps WHERE task_id='t1'", [], |r| r.get(0))
            .unwrap();
        let delays: i64 = c
            .query_row("SELECT COUNT(*) FROM delays WHERE task_id='t1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(steps, 0);
        assert_eq!(delays, 0);
    }

    #[test]
    fn a_task_must_be_archived_before_it_is_deleted() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();

        assert_eq!(
            archive::delete_task(&c, "t1").unwrap_err(),
            "task_not_archived"
        );

        crate::repo::tasks::archive(&c, "t1", NOW).unwrap();
        archive::delete_task(&c, "t1").unwrap();
        let left: i64 = c
            .query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 0);
    }

    #[test]
    fn a_canceled_task_can_be_deleted() {
        // Canceling is the design's "archive directly" exit, so the archive page may delete it.
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "不再需要", NOW, "t1").unwrap();
        week::resolve(
            &c,
            "t1",
            crate::services::week::PassAction::Cancel,
            None,
            NOW,
        )
        .unwrap();

        archive::delete_task(&c, "t1").unwrap();
        let left: i64 = c
            .query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 0);
    }

    #[test]
    fn archived_task_hides_from_project_list_and_stats() {
        let c = db::open_in_memory().unwrap();
        let p = crate::services::projects::create(&c, "项目", None, NOW).unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        c.execute("UPDATE tasks SET project_id = ?1 WHERE id='t1'", [&p.id])
            .unwrap();

        crate::repo::tasks::archive(&c, "t1", NOW).unwrap();
        assert!(
            crate::repo::tasks::list_project(&c, &p.id)
                .unwrap()
                .is_empty()
        );
        assert_eq!(crate::services::stats::summary(&c, &p.id).unwrap().total, 0);
    }

    #[test]
    fn archiving_project_removes_its_tasks_from_week() {
        let c = db::open_in_memory().unwrap();
        let p = crate::services::projects::create(&c, "项目", None, NOW).unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        c.execute("UPDATE tasks SET project_id = ?1 WHERE id='t1'", [&p.id])
            .unwrap();

        crate::repo::projects::set_archived(&c, &p.id, true, NOW).unwrap();
        assert!(week::list(&c).unwrap().is_empty());
        assert!(week::pass_queue(&c).unwrap().is_empty());
    }

    #[test]
    fn restoring_a_project_returns_active_tasks_to_week() {
        let c = db::open_in_memory().unwrap();
        let p = crate::services::projects::create(&c, "项目", None, NOW).unwrap();
        for id in ["t1", "t2", "t3", "t4"] {
            week::capture(&c, id, NOW, id).unwrap();
            c.execute(
                "UPDATE tasks SET project_id = ?1 WHERE id = ?2",
                rusqlite::params![&p.id, id],
            )
            .unwrap();
        }
        crate::services::tasks::set_status(&c, "t2", "done", NOW).unwrap();
        week::resolve(
            &c,
            "t3",
            crate::services::week::PassAction::Suspend,
            Some("2026-11-02"),
            NOW,
        )
        .unwrap();
        week::resolve(
            &c,
            "t4",
            crate::services::week::PassAction::Cancel,
            None,
            NOW,
        )
        .unwrap();

        crate::repo::projects::set_archived(&c, &p.id, true, NOW).unwrap();
        assert!(week::list(&c).unwrap().is_empty());

        crate::repo::projects::set_archived(&c, &p.id, false, NOW).unwrap();

        let ids: Vec<String> = week::list(&c)
            .unwrap()
            .into_iter()
            .map(|t| t.id)
            .collect();
        assert_eq!(ids, vec!["t1"]);
        for id in ["t2", "t3", "t4"] {
            let in_week: i64 = c
                .query_row("SELECT in_week FROM tasks WHERE id = ?1", [id], |r| {
                    r.get(0)
                })
                .unwrap();
            assert_eq!(in_week, 0, "{id}");
        }
    }

    #[test]
    fn restoring_a_suspended_task_clears_the_suspension() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        week::resolve(
            &c,
            "t1",
            crate::services::week::PassAction::Suspend,
            Some("2026-11-02"),
            NOW,
        )
        .unwrap();
        crate::repo::tasks::archive(&c, "t1", NOW).unwrap();

        let t = archive::restore_task(&c, "t1", NOW).unwrap();

        assert!(t.in_week);
        assert!(t.suspended_until.is_none());
        assert!(week::list_suspended(&c).unwrap().is_empty());
    }

    #[test]
    fn restore_done_task_returns_it_as_doing() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "做完了", NOW, "t1").unwrap();
        crate::repo::tasks::set_status(&c, "t1", "done", true, NOW).unwrap();
        let t = archive::restore_task(&c, "t1", NOW).unwrap();
        assert_eq!(t.status, "doing");
        assert!(t.in_week);
    }

    #[test]
    fn search_matches_title_substring() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "问采购螺丝的事", NOW, "t1").unwrap();
        week::capture(&c, "交底", NOW, "t2").unwrap();
        crate::repo::tasks::archive(&c, "t1", NOW).unwrap();
        crate::repo::tasks::archive(&c, "t2", NOW).unwrap();

        let found = archive::list(&c, Some("螺丝")).unwrap();
        assert_eq!(found.tasks.len(), 1);
        assert_eq!(found.tasks[0].id, "t1");
        assert_eq!(archive::list(&c, Some("没有")).unwrap().tasks.len(), 0);
    }
}