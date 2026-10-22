use crate::dto::{CategoryProgressDto, ProjectSummaryDto};
use crate::repo::projects;
use rusqlite::Connection;

pub fn summary(conn: &Connection, project_id: &str) -> Result<ProjectSummaryDto, String> {
    let project = projects::dto(conn, project_id).map_err(|e| e.to_string())?;

    let (total, done): (i64, i64) = conn
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(status = 'done'), 0) FROM tasks
             WHERE project_id = ?1 AND deleted_at IS NULL AND canceled_at IS NULL AND archived_at IS NULL",
            [project_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT c.id, c.name, COUNT(t.id), COALESCE(SUM(t.status = 'done'), 0)
             FROM tasks t JOIN categories c ON c.id = t.category_id
             WHERE t.project_id = ?1 AND t.deleted_at IS NULL AND t.canceled_at IS NULL
               AND t.archived_at IS NULL AND c.deleted_at IS NULL
             GROUP BY c.id, c.name, c.sort_order
             ORDER BY c.sort_order",
        )
        .map_err(|e| e.to_string())?;
    let by_category: Vec<CategoryProgressDto> = stmt
        .query_map([project_id], |r| {
            Ok(CategoryProgressDto {
                category_id: r.get(0)?,
                name: r.get(1)?,
                total: r.get(2)?,
                done: r.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;

    Ok(ProjectSummaryDto {
        id: project.id,
        name: project.name,
        due_date: project.due_date,
        total,
        done,
        by_category,
    })
}

pub fn list(conn: &Connection) -> Result<Vec<ProjectSummaryDto>, String> {
    projects::list(conn)
        .map_err(|e| e.to_string())?
        .iter()
        .map(|p| summary(conn, &p.id))
        .collect()
}

#[cfg(test)]
mod tests {
    use crate::db;
    use crate::repo::categories;
    use crate::services::{projects, stats, week};
    use rusqlite::Connection;

    const NOW: &str = "2026-10-20T08:00:00Z";

    fn setup() -> (Connection, String) {
        let c = db::open_in_memory().unwrap();
        let p = projects::create(&c, "华东客户交付", Some("2026-11-20"), NOW).unwrap();
        let cats = categories::list(&c).unwrap();
        let software = cats.iter().find(|x| x.name == "软件").unwrap().id.clone();
        let docs = cats.iter().find(|x| x.name == "资料").unwrap().id.clone();

        week::capture(&c, "方案评审", NOW, "t1").unwrap();
        week::capture(&c, "接口协议", NOW, "t2").unwrap();
        week::capture(&c, "资料目录", NOW, "t3").unwrap();
        week::capture(&c, "不要了", NOW, "t4").unwrap();

        for (id, cat) in [
            ("t1", software.as_str()),
            ("t2", software.as_str()),
            ("t4", software.as_str()),
            ("t3", docs.as_str()),
        ] {
            c.execute(
                "UPDATE tasks SET project_id = ?1, category_id = ?2 WHERE id = ?3",
                rusqlite::params![p.id, cat, id],
            )
            .unwrap();
        }
        c.execute("UPDATE tasks SET status='done' WHERE id='t1'", [])
            .unwrap();
        c.execute("UPDATE tasks SET canceled_at=?1 WHERE id='t4'", [NOW])
            .unwrap();

        (c, p.id)
    }

    #[test]
    fn canceled_tasks_leave_denominator_and_suspended_stay() {
        let (c, id) = setup();
        c.execute(
            "UPDATE tasks SET in_week=0, suspended=1, suspended_until='2026-11-01'
             WHERE id='t3'",
            [],
        )
        .unwrap();
        let s = stats::summary(&c, &id).unwrap();
        assert_eq!(s.total, 3);
        assert_eq!(s.done, 1);
        assert_eq!(s.by_category.len(), 2);
        assert_eq!(s.by_category[0].name, "软件");
        assert_eq!(s.by_category[0].total, 2);
        assert_eq!(s.by_category[0].done, 1);
        assert_eq!(s.by_category[1].name, "资料");
        assert_eq!(s.by_category[1].total, 1);
        assert_eq!(s.by_category[1].done, 0);
    }
}