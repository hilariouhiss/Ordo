use crate::dto::{ArchiveDto, TaskDto};
use crate::repo::{projects, tasks};
use rusqlite::{params, Connection, OptionalExtension};

pub fn list(conn: &Connection, query: Option<&str>) -> Result<ArchiveDto, String> {
    Ok(ArchiveDto {
        projects: projects::list_archived(conn, query).map_err(|e| e.to_string())?,
        tasks: tasks::list_archived(conn, query).map_err(|e| e.to_string())?,
        canceled: tasks::list_canceled(conn, query).map_err(|e| e.to_string())?,
        done: tasks::list_done(conn, query).map_err(|e| e.to_string())?,
    })
}

fn task_exists(conn: &Connection, id: &str) -> Result<bool, String> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM tasks WHERE id = ?1 AND deleted_at IS NULL)",
        [id],
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}

/// Files a task, taking its subtasks with it: filing the umbrella files the work.
pub fn archive_task(conn: &Connection, id: &str, now: &str) -> Result<TaskDto, String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    if !task_exists(&tx, id)? {
        return Err("task_not_found".into());
    }
    tasks::archive(&tx, id, now).map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE tasks SET archived_at = ?1, in_week = 0, updated_at = ?1
         WHERE parent_id = ?2 AND deleted_at IS NULL",
        params![now, id],
    )
    .map_err(|e| e.to_string())?;
    crate::services::subtasks::sync_parent(&tx, id, now)?;
    tx.commit().map_err(|e| e.to_string())?;
    tasks::dto(conn, id).map_err(|e| e.to_string())
}

/// A task inside an archived project is hidden from every list, so it cannot come back alone.
fn project_is_archived(conn: &Connection, id: &str) -> Result<bool, String> {
    conn.query_row(
        "SELECT COUNT(*) FROM tasks t JOIN projects p ON p.id = t.project_id
         WHERE t.id = ?1 AND p.archived_at IS NOT NULL",
        [id],
        |r| r.get::<_, i64>(0).map(|count| count > 0),
    )
    .map_err(|e| e.to_string())
}

/// The latest live subtask, which is the one a restored umbrella continues from.
fn last_live_child(conn: &Connection, id: &str) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT id FROM tasks WHERE parent_id = ?1 AND deleted_at IS NULL
           AND canceled_at IS NULL AND archived_at IS NULL
         ORDER BY sort_order DESC LIMIT 1",
        [id],
        |r| r.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn restore_task(conn: &Connection, id: &str, now: &str) -> Result<TaskDto, String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    if !task_exists(&tx, id)? {
        return Err("task_not_found".into());
    }
    // The week hides archived projects, so a task restored into one would be lost from every list.
    if project_is_archived(&tx, id)? {
        return Err("project_archived".into());
    }
    // A canceled subtask comes back with its umbrella, never as live work under a filed parent.
    let parent_archived: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM tasks t JOIN tasks p ON p.id = t.parent_id
             WHERE t.id = ?1 AND p.archived_at IS NOT NULL",
            [id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if parent_archived > 0 {
        return Err("parent_archived".into());
    }
    let was_done = tasks::stored_status(&tx, id).map_err(|e| e.to_string())? == "done";
    tasks::restore(&tx, id, now).map_err(|e| e.to_string())?;
    // The work comes back with the umbrella; a child canceled on purpose stays canceled.
    tx.execute(
        "UPDATE tasks SET archived_at = NULL, updated_at = ?1,
                in_week = CASE WHEN status = 'done' OR suspended THEN 0 ELSE 1 END
         WHERE parent_id = ?2 AND deleted_at IS NULL",
        params![now, id],
    )
    .map_err(|e| e.to_string())?;
    if was_done {
        // Reopen the current subtask, so the derived status agrees with what the user sees.
        if let Some(child) = last_live_child(&tx, id)? {
            crate::services::tasks::set_status(&tx, &child, "doing", now)?;
        }
    }
    crate::services::subtasks::sync_parent(&tx, id, now)?;
    tx.commit().map_err(|e| e.to_string())?;
    tasks::dto(conn, id).map_err(|e| e.to_string())
}

/// The undo of archiving: clear the flag and put the task back where it belongs.
/// Status, actual times and a suspension stay as they were, so a finished task comes
/// back finished and out of the week instead of turning into open work again.
pub fn unarchive_task(conn: &Connection, id: &str, now: &str) -> Result<TaskDto, String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    // Undoing an archive must not put the task back where no list can show it.
    if project_is_archived(&tx, id)? {
        return Err("project_archived".into());
    }
    let sql = "UPDATE tasks SET archived_at = NULL, updated_at = ?1,
                    in_week = CASE WHEN status = 'done' OR suspended THEN 0 ELSE 1 END
               WHERE ";
    let changed = tx
        .execute(&format!("{sql}id = ?2"), params![now, id])
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("task_not_found".into());
    }
    tx.execute(
        &format!("{sql}parent_id = ?2 AND deleted_at IS NULL"),
        params![now, id],
    )
    .map_err(|e| e.to_string())?;
    crate::services::subtasks::sync_parent(&tx, id, now)?;
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
    fn delete_cascades_subtasks_and_delays() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        crate::services::subtasks::add(&c, "t1", "一步", NOW).unwrap();
        crate::services::deliverables::add_note(&c, "t1", "等回复", NOW).unwrap();
        archive::archive_task(&c, "t1", NOW).unwrap();

        archive::delete_task(&c, "t1").unwrap();
        let children: i64 = c
            .query_row(
                "SELECT COUNT(*) FROM tasks WHERE parent_id='t1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let delays: i64 = c
            .query_row("SELECT COUNT(*) FROM delays WHERE task_id='t1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(children, 0);
        assert_eq!(delays, 0);
    }

    #[test]
    fn archiving_an_umbrella_files_its_children() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        let parent = crate::services::subtasks::add(&c, "t1", "收集清单", NOW).unwrap();
        let child = parent.children[0].id.clone();

        archive::archive_task(&c, "t1", NOW).unwrap();

        let filed: Option<String> = c
            .query_row("SELECT archived_at FROM tasks WHERE id = ?1", [&child], |r| {
                r.get(0)
            })
            .unwrap();
        assert!(filed.is_some());
        assert!(week::list(&c).unwrap().is_empty());

        archive::unarchive_task(&c, "t1", NOW).unwrap();
        let back: Option<String> = c
            .query_row("SELECT archived_at FROM tasks WHERE id = ?1", [&child], |r| {
                r.get(0)
            })
            .unwrap();
        assert!(back.is_none());
        assert_eq!(week::list(&c).unwrap().len(), 1);
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
        let p = crate::services::projects::create(&c, "项目", NOW).unwrap();
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
        let p = crate::services::projects::create(&c, "项目", NOW).unwrap();
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
        let p = crate::services::projects::create(&c, "项目", NOW).unwrap();
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
        let p = crate::services::projects::create(&c, "项目", NOW).unwrap();
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
        crate::repo::tasks::set_status(&c, "t1", "done", true, NOW).unwrap();
        let t = archive::restore_task(&c, "t1", NOW).unwrap();
        assert_eq!(t.status, "doing");
        assert!(t.in_week);
        assert!(t.actual_finish_at.is_none());
        assert!(
            t.actual_effort_minutes.is_none(),
            "a reopened task has no recorded effort any more"
        );
    }

    #[test]
    fn restoring_a_done_task_in_an_archived_project_is_refused() {
        let c = db::open_in_memory().unwrap();
        let p = crate::services::projects::create(&c, "项目", NOW).unwrap();
        week::capture(&c, "做完了", NOW, "t1").unwrap();
        c.execute("UPDATE tasks SET project_id = ?1 WHERE id = 't1'", [&p.id])
            .unwrap();
        crate::services::tasks::set_status(&c, "t1", "done", NOW).unwrap();
        crate::repo::projects::set_archived(&c, &p.id, true, NOW).unwrap();

        assert_eq!(
            archive::restore_task(&c, "t1", NOW).unwrap_err(),
            "project_archived"
        );
        let task = crate::repo::tasks::dto(&c, "t1").unwrap();
        assert_eq!(task.status, "done");
        assert!(!task.in_week);
    }

    #[test]
    fn archive_lists_wait_for_an_archived_project_to_be_restored() {
        let c = db::open_in_memory().unwrap();
        let p = crate::services::projects::create(&c, "项目", NOW).unwrap();
        week::capture(&c, "做完了", NOW, "t1").unwrap();
        c.execute("UPDATE tasks SET project_id = ?1 WHERE id = 't1'", [&p.id])
            .unwrap();
        crate::services::tasks::set_status(&c, "t1", "done", NOW).unwrap();
        crate::repo::projects::set_archived(&c, &p.id, true, NOW).unwrap();

        assert!(archive::list(&c, None).unwrap().done.is_empty());
        assert!(archive::list(&c, None).unwrap().tasks.is_empty());

        crate::repo::projects::set_archived(&c, &p.id, false, NOW).unwrap();
        assert_eq!(archive::list(&c, None).unwrap().done.len(), 1);
    }

    #[test]
    fn archiving_a_project_hides_its_tasks_from_the_week_surfaces() {
        let c = db::open_in_memory().unwrap();
        let p = crate::services::projects::create(&c, "项目", NOW).unwrap();
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
    fn restoring_an_umbrella_leaves_a_canceled_child_canceled() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        let parent = crate::services::subtasks::add(&c, "t1", "收集", NOW).unwrap();
        let first = parent.children[0].id.clone();
        let parent = crate::services::subtasks::add(&c, "t1", "汇编", NOW).unwrap();
        let canceled = parent.children[1].id.clone();
        week::resolve(&c, &canceled, week::PassAction::Cancel, None, None, NOW).unwrap();

        archive::archive_task(&c, "t1", NOW).unwrap();
        archive::restore_task(&c, "t1", NOW).unwrap();

        let still: Option<String> = c
            .query_row("SELECT canceled_at FROM tasks WHERE id = ?1", [&canceled], |r| {
                r.get(0)
            })
            .unwrap();
        assert!(still.is_some(), "restoring the umbrella must not undo a cancel");
        let first_canceled: Option<String> = c
            .query_row("SELECT canceled_at FROM tasks WHERE id = ?1", [&first], |r| {
                r.get(0)
            })
            .unwrap();
        assert!(first_canceled.is_none());
    }

    #[test]
    fn a_canceled_child_of_an_archived_umbrella_waits_for_the_umbrella() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交付", NOW, "p").unwrap();
        let parent = crate::services::subtasks::add(&c, "p", "收集", NOW).unwrap();
        let child = parent.children[0].id.clone();
        week::resolve(&c, &child, week::PassAction::Cancel, None, None, NOW).unwrap();
        archive::archive_task(&c, "p", NOW).unwrap();

        // Archived with the umbrella: restoring the child alone would leave live work
        // under a filed parent.
        assert!(archive::list(&c, None).unwrap().canceled.is_empty());
        assert_eq!(
            archive::restore_task(&c, &child, NOW).unwrap_err(),
            "parent_archived"
        );
        assert!(week::list(&c).unwrap().is_empty());

        archive::restore_task(&c, "p", NOW).unwrap();
        assert_eq!(archive::list(&c, None).unwrap().canceled.len(), 1);
    }

    #[test]
    fn restoring_a_done_umbrella_reopens_its_last_subtask() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        let t = crate::services::subtasks::add(&c, "t1", "收集", NOW).unwrap();
        let first = t.children[0].id.clone();
        let t = crate::services::subtasks::add(&c, "t1", "汇编", NOW).unwrap();
        let last = t.children[1].id.clone();
        crate::services::tasks::set_status(&c, &first, "done", NOW).unwrap();
        let done = crate::services::tasks::set_status(&c, &last, "done", NOW).unwrap();
        assert_eq!(done.status, "done");

        archive::archive_task(&c, "t1", NOW).unwrap();
        let restored = archive::restore_task(&c, "t1", NOW).unwrap();

        assert_eq!(restored.status, "doing");
        assert!(restored.in_week);
        assert!(restored.actual_finish_at.is_none());
        assert!(restored.actual_effort_minutes.is_none());
        assert!(restored.children[0].status == "done");
        assert!(restored.children[1].status != "done");

        let finished =
            crate::services::tasks::set_status(&c, &restored.children[1].id, "done", NOW).unwrap();
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

        let p = crate::services::projects::create(&c, "50% 项目", NOW).unwrap();
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

    #[test]
    fn undoing_an_archive_keeps_a_finished_task_finished() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "发版", NOW, "t1").unwrap();
        let done = crate::services::tasks::set_status(&c, "t1", "done", NOW).unwrap();
        crate::repo::tasks::archive(&c, "t1", NOW).unwrap();

        let back = archive::unarchive_task(&c, "t1", NOW).unwrap();

        assert_eq!(back.status, "done");
        assert_eq!(back.actual_finish_at, done.actual_finish_at);
        assert_eq!(back.actual_effort_minutes, done.actual_effort_minutes);
        assert!(back.archived_at.is_none());
        assert!(!back.in_week, "a finished task stays out of the week");
    }

    #[test]
    fn undoing_an_archive_returns_an_open_task_to_the_week() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        crate::repo::tasks::archive(&c, "t1", NOW).unwrap();

        let back = archive::unarchive_task(&c, "t1", NOW).unwrap();

        assert!(back.in_week);
        assert_eq!(back.status, "todo");
        assert!(back.archived_at.is_none());
    }

    #[test]
    fn undoing_an_archive_into_an_archived_project_is_refused() {
        let c = db::open_in_memory().unwrap();
        let p = crate::services::projects::create(&c, "项目", NOW).unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        c.execute(
            "UPDATE tasks SET project_id = ?1 WHERE id = 't1'",
            [&p.id],
        )
        .unwrap();
        archive::archive_task(&c, "t1", NOW).unwrap();
        crate::repo::projects::set_archived(&c, &p.id, true, NOW).unwrap();

        assert_eq!(
            archive::unarchive_task(&c, "t1", NOW).unwrap_err(),
            "project_archived"
        );
        let archived: Option<String> = c
            .query_row("SELECT archived_at FROM tasks WHERE id = 't1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert!(archived.is_some());
    }

    #[test]
    fn undoing_an_archive_leaves_a_parked_task_parked() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "等甲方", NOW, "t1").unwrap();
        week::resolve(
            &c,
            "t1",
            week::PassAction::Suspend,
            Some("2026-11-02"),
            None,
            NOW,
        )
        .unwrap();
        crate::repo::tasks::archive(&c, "t1", NOW).unwrap();

        let back = archive::unarchive_task(&c, "t1", NOW).unwrap();

        assert!(back.suspended);
        assert!(!back.in_week);
        assert!(back.archived_at.is_none());
    }

    #[test]
    fn a_missing_task_is_reported_as_missing() {
        let c = db::open_in_memory().unwrap();
        assert_eq!(
            archive::restore_task(&c, "gone", NOW).unwrap_err(),
            "task_not_found"
        );
        assert_eq!(
            archive::archive_task(&c, "gone", NOW).unwrap_err(),
            "task_not_found"
        );
    }

    #[test]
    fn undoing_an_archive_of_a_missing_task_is_an_error() {
        let c = db::open_in_memory().unwrap();
        assert_eq!(
            archive::unarchive_task(&c, "nope", NOW).unwrap_err(),
            "task_not_found"
        );
    }
}
