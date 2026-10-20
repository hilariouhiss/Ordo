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
    tasks::delete(conn, id).map_err(|e| e.to_string())
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
    fn delete_cascades_steps_and_delays() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        crate::services::steps::add(&c, "t1", "一步", NOW).unwrap();
        crate::services::deliverables::add_note(&c, "t1", "等回复", NOW).unwrap();

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