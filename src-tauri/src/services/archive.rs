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
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let was_done = tasks::stored_status(&tx, id).map_err(|e| e.to_string())? == "done";
    tasks::restore(&tx, id, now).map_err(|e| e.to_string())?;
    if was_done {
        // Reopen the current step, so the stored status agrees with what the user sees.
        if let Some(step_id) = crate::repo::steps::last_live(&tx, id).map_err(|e| e.to_string())? {
            crate::repo::steps::set_done(&tx, &step_id, false, now).map_err(|e| e.to_string())?;
        }
        crate::services::steps::recompute(&tx, id, now)?;
    }
    tx.commit().map_err(|e| e.to_string())?;
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
            None,
            NOW,
        )
        .unwrap();
        week::resolve(
            &c,
            "t4",
            crate::services::week::PassAction::Cancel,
            None,
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
    fn restoring_a_project_keeps_the_tasks_order() {
        let c = db::open_in_memory().unwrap();
        let p = crate::services::projects::create(&c, "项目", None, NOW).unwrap();
        for id in ["t1", "t2", "t3"] {
            week::capture(&c, id, NOW, id).unwrap();
            c.execute(
                "UPDATE tasks SET project_id = ?1 WHERE id = ?2",
                rusqlite::params![&p.id, id],
            )
            .unwrap();
        }
        crate::services::tasks::move_task(&c, "t3", Some("t1")).unwrap();
        crate::repo::projects::set_archived(&c, &p.id, true, NOW).unwrap();
        crate::repo::projects::set_archived(&c, &p.id, false, NOW).unwrap();

        let mut stmt = c
            .prepare("SELECT id, sort_order FROM tasks WHERE project_id = ?1 ORDER BY sort_order, id")
            .unwrap();
        let restored: Vec<(String, i64)> = stmt
            .query_map([&p.id], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert_eq!(
            restored.iter().map(|(id, _)| id.as_str()).collect::<Vec<_>>(),
            vec!["t3", "t1", "t2"]
        );
        assert!(restored.windows(2).all(|w| w[0].1 < w[1].1));

        let week_ids: Vec<String> = week::list(&c)
            .unwrap()
            .into_iter()
            .map(|t| t.id)
            .collect();
        assert_eq!(week_ids, vec!["t3", "t1", "t2"]);
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
            None,
            NOW,
        )
        .unwrap();
        crate::repo::tasks::archive(&c, "t1", NOW).unwrap();

        let t = archive::restore_task(&c, "t1", NOW).unwrap();

        assert!(t.in_week);
        assert!(!t.suspended);
        assert!(t.suspended_until.is_none());
        assert!(t.suspended_at.is_none());
        assert!(t.suspend_reason.is_none());
        assert!(week::list_suspended(&c).unwrap().is_empty());
    }

    #[test]
    fn restore_done_task_returns_it_as_doing() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "做完了", NOW, "t1").unwrap();
        crate::repo::tasks::set_status(&c, "t1", "done", true, NOW, None).unwrap();
        let t = archive::restore_task(&c, "t1", NOW).unwrap();
        assert_eq!(t.status, "doing");
        assert!(t.in_week);
    }

    #[test]
    fn archiving_a_project_hides_its_tasks_from_the_week_surfaces() {
        let c = db::open_in_memory().unwrap();
        let p = crate::services::projects::create(&c, "项目", None, NOW).unwrap();
        for (id, title) in [("t1", "挂起的"), ("t2", "进行中")] {
            week::capture(&c, title, NOW, id).unwrap();
            c.execute(
                "UPDATE tasks SET project_id = ?1 WHERE id = ?2",
                rusqlite::params![&p.id, id],
            )
            .unwrap();
        }
        week::resolve(
            &c,
            "t1",
            crate::services::week::PassAction::Suspend,
            Some("2026-11-02"),
            None,
            NOW,
        )
        .unwrap();
        assert_eq!(week::list_suspended(&c).unwrap().len(), 1);

        crate::repo::projects::set_archived(&c, &p.id, true, NOW).unwrap();

        assert_eq!(week::list_suspended(&c).unwrap().len(), 0);
        assert!(week::list(&c).unwrap().is_empty());
        assert!(week::pass_queue(&c).unwrap().is_empty());

        week::start(&c, "t2", NOW).unwrap();
        assert!(week::list(&c).unwrap().is_empty());

        crate::repo::projects::set_archived(&c, &p.id, false, NOW).unwrap();
        assert_eq!(week::list_suspended(&c).unwrap().len(), 1);
        assert!(!week::list(&c).unwrap().iter().any(|t| t.id == "t1"));
        week::resume(&c, "t1", NOW).unwrap();
        let ids: Vec<String> = week::list(&c).unwrap().into_iter().map(|t| t.id).collect();
        assert!(ids.contains(&"t1".to_string()));
        assert!(ids.contains(&"t2".to_string()));
    }

    #[test]
    fn restoring_a_done_step_task_reopens_the_last_step() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        let t = crate::services::steps::add(&c, "t1", "收集", NOW).unwrap();
        let first = t.steps[0].id.clone();
        let t = crate::services::steps::add(&c, "t1", "汇编", NOW).unwrap();
        let last = t.steps[1].id.clone();
        crate::services::steps::toggle(&c, &first, NOW).unwrap();
        let done = crate::services::steps::toggle(&c, &last, NOW).unwrap();
        assert_eq!(done.status, "done");
        assert!(!done.in_week);

        crate::repo::tasks::archive(&c, "t1", NOW).unwrap();
        let restored = archive::restore_task(&c, "t1", NOW).unwrap();

        assert_eq!(restored.status, "doing");
        assert!(restored.in_week);
        assert!(restored.steps[0].done);
        assert!(!restored.steps[1].done);

        let finished = crate::services::steps::toggle(&c, &restored.steps[1].id, NOW).unwrap();
        assert_eq!(finished.status, "done");
        assert!(!finished.in_week);
    }

    #[test]
    fn search_matches_literal_wildcards() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "完成 50% 的报表", NOW, "t1").unwrap();
        week::capture(&c, "a_b 的表格", NOW, "t2").unwrap();
        week::capture(&c, "axb 的表格", NOW, "t3").unwrap();
        for id in ["t1", "t2", "t3"] {
            crate::repo::tasks::archive(&c, id, NOW).unwrap();
        }

        let percent = archive::list(&c, Some("%")).unwrap();
        assert_eq!(percent.tasks.len(), 1);
        assert_eq!(percent.tasks[0].id, "t1");
        assert_eq!(percent.tasks[0].title, "完成 50% 的报表");
        assert!(percent.tasks[0].archived_at.is_some());
        assert!(percent.tasks[0].canceled_at.is_none());

        let underscore = archive::list(&c, Some("_")).unwrap();
        assert_eq!(underscore.tasks.len(), 1);
        assert_eq!(underscore.tasks[0].id, "t2");

        let p = crate::services::projects::create(&c, "50% 项目", None, NOW).unwrap();
        crate::repo::projects::set_archived(&c, &p.id, true, NOW).unwrap();
        let projects = archive::list(&c, Some("%")).unwrap();
        assert_eq!(projects.projects.len(), 1);
        assert_eq!(projects.projects[0].id, p.id);
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