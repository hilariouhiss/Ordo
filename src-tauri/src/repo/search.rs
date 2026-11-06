use crate::dto::SearchHitDto;
use rusqlite::Connection;

/// Task titles in every state plus live project names. The archive and the task
/// page search titles the same way, so a literal `%` or `_` stays literal here too.
pub fn search(conn: &Connection, query: &str) -> rusqlite::Result<Vec<SearchHitDto>> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let pattern = crate::repo::like_pattern(query);
    let mut hits = Vec::new();

    // Active tasks first, then finished, archived and canceled ones. The project
    // name rides along so the palette can show where a task belongs.
    let mut tasks = conn.prepare(&format!(
        "SELECT id, title,
                (SELECT name FROM projects WHERE id = tasks.project_id AND deleted_at IS NULL),
                status, archived_at, canceled_at
         FROM tasks
         WHERE deleted_at IS NULL AND {} AND title LIKE ?1 ESCAPE '!'
         ORDER BY CASE
             WHEN archived_at IS NULL AND canceled_at IS NULL AND status <> 'done' THEN 0
             WHEN archived_at IS NULL AND canceled_at IS NULL THEN 1
             WHEN archived_at IS NOT NULL THEN 2
             ELSE 3 END,
             updated_at DESC
         LIMIT 40",
        crate::repo::tasks::LIVE_PROJECT
    ))?;
    let rows = tasks.query_map([&pattern], |row| {
        let status: String = row.get(3)?;
        let archived: Option<String> = row.get(4)?;
        let canceled: Option<String> = row.get(5)?;
        let state = if canceled.is_some() {
            "canceled"
        } else if archived.is_some() {
            "archived"
        } else if status == "done" {
            "done"
        } else {
            "active"
        };
        Ok(SearchHitDto {
            kind: "task".into(),
            id: row.get(0)?,
            title: row.get(1)?,
            subtitle: row.get(2)?,
            state: state.into(),
        })
    })?;
    for row in rows {
        hits.push(row?);
    }

    // Archived projects belong to the archive page, which has its own search.
    let mut projects = conn.prepare(
        "SELECT id, name FROM projects
         WHERE deleted_at IS NULL AND archived_at IS NULL AND name LIKE ?1 ESCAPE '!'
         ORDER BY updated_at DESC
         LIMIT 10",
    )?;
    let rows = projects.query_map([&pattern], |row| {
        Ok(SearchHitDto {
            kind: "project".into(),
            id: row.get(0)?,
            title: row.get(1)?,
            subtitle: None,
            state: "active".into(),
        })
    })?;
    for row in rows {
        hits.push(row?);
    }
    Ok(hits)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::services::{projects, tasks as task_service, week};

    const NOW: &str = "2026-10-20T08:00:00Z";

    fn ids(hits: &[SearchHitDto]) -> Vec<String> {
        hits.iter().map(|hit| hit.id.clone()).collect()
    }

    #[test]
    fn finds_tasks_in_every_state_in_priority_order() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        week::capture(&c, "交底会议纪要", NOW, "t2").unwrap();
        week::capture(&c, "交底前确认", NOW, "t3").unwrap();
        week::capture(&c, "交底复盘", NOW, "t4").unwrap();
        crate::repo::tasks::archive(&c, "t2", NOW).unwrap();
        week::resolve(&c, "t3", week::PassAction::Cancel, None, None, NOW).unwrap();
        task_service::set_status(&c, "t4", "done", NOW).unwrap();

        let hits = search(&c, "交底").unwrap();

        assert_eq!(ids(&hits), vec!["t1", "t4", "t2", "t3"]);
        assert_eq!(hits[0].state, "active");
        assert_eq!(hits[1].state, "done");
        assert_eq!(hits[2].state, "archived");
        assert_eq!(hits[3].state, "canceled");
        assert!(hits.iter().all(|hit| hit.kind == "task"));
    }

    #[test]
    fn keeps_the_project_name_as_the_subtitle() {
        let c = db::open_in_memory().unwrap();
        let p = projects::create(&c, "滨江花园", NOW).unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        c.execute(
            "UPDATE tasks SET project_id = ?1 WHERE id = 't1'",
            [&p.id],
        )
        .unwrap();

        let hits = search(&c, "交底").unwrap();

        assert_eq!(hits[0].subtitle.as_deref(), Some("滨江花园"));
    }

    #[test]
    fn ignores_tasks_in_archived_projects() {
        let c = db::open_in_memory().unwrap();
        let p = projects::create(&c, "滨江", NOW).unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        c.execute(
            "UPDATE tasks SET project_id = ?1 WHERE id = 't1'",
            [&p.id],
        )
        .unwrap();
        crate::repo::projects::set_archived(&c, &p.id, true, NOW).unwrap();

        assert!(search(&c, "交底").unwrap().is_empty());
    }

    #[test]
    fn finds_live_projects_only() {
        let c = db::open_in_memory().unwrap();
        let live = projects::create(&c, "滨江花园", NOW).unwrap();
        let gone = projects::create(&c, "滨江旧项目", NOW).unwrap();
        crate::repo::projects::set_archived(&c, &gone.id, true, NOW).unwrap();

        let hits = search(&c, "滨江").unwrap();

        assert_eq!(ids(&hits), vec![live.id]);
        assert_eq!(hits[0].kind, "project");
        assert_eq!(hits[0].state, "active");
        assert!(hits[0].subtitle.is_none());
    }

    #[test]
    fn matches_literal_wildcards() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "完成 50% 的报表", NOW, "t1").unwrap();
        week::capture(&c, "a_b 的表格", NOW, "t2").unwrap();
        week::capture(&c, "axb 的表格", NOW, "t3").unwrap();

        let percent = search(&c, "%").unwrap();
        assert_eq!(ids(&percent), vec!["t1"]);
        let underscore = search(&c, "_").unwrap();
        assert_eq!(ids(&underscore), vec!["t2"]);
    }

    #[test]
    fn an_empty_query_finds_nothing() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();

        assert!(search(&c, "   ").unwrap().is_empty());
    }
}
