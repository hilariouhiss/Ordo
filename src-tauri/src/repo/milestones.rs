use crate::dto::MilestoneDto;
use rusqlite::{params, Connection};

fn from_row(r: &rusqlite::Row) -> rusqlite::Result<MilestoneDto> {
    Ok(MilestoneDto {
        id: r.get(0)?,
        title: r.get(1)?,
        due_date: r.get(2)?,
        done_at: r.get(3)?,
    })
}

pub fn insert(
    conn: &Connection,
    id: &str,
    project_id: &str,
    title: &str,
    due_date: Option<&str>,
    now: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO project_milestones (id, project_id, title, due_date, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        params![id, project_id, title, due_date, now],
    )?;
    Ok(())
}

pub fn set_title(conn: &Connection, id: &str, title: &str, now: &str) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE project_milestones SET title = ?1, updated_at = ?2 WHERE id = ?3",
        params![title, now, id],
    )
}

pub fn set_date(
    conn: &Connection,
    id: &str,
    due_date: Option<&str>,
    now: &str,
) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE project_milestones SET due_date = ?1, updated_at = ?2 WHERE id = ?3",
        params![due_date, now, id],
    )
}

pub fn set_done(
    conn: &Connection,
    id: &str,
    done: bool,
    now: &str,
) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE project_milestones SET done_at = ?1, updated_at = ?2 WHERE id = ?3",
        params![if done { Some(now) } else { None }, now, id],
    )
}

pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM project_milestones WHERE id = ?1", [id])?;
    Ok(())
}

pub fn dto(conn: &Connection, id: &str) -> rusqlite::Result<MilestoneDto> {
    conn.query_row(
        "SELECT id, title, due_date, done_at FROM project_milestones WHERE id = ?1",
        [id],
        from_row,
    )
}

/// Open dated first, then open without a day, then the finished ones.
pub fn list(conn: &Connection, project_id: &str) -> rusqlite::Result<Vec<MilestoneDto>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, due_date, done_at FROM project_milestones
         WHERE project_id = ?1
         ORDER BY (done_at IS NOT NULL), (due_date IS NULL), due_date, created_at",
    )?;
    let rows = stmt.query_map([project_id], from_row)?;
    rows.collect()
}

/// Every milestone paired with its project, for the project list's counters.
pub fn all(conn: &Connection) -> rusqlite::Result<Vec<(String, MilestoneDto)>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, due_date, done_at, project_id FROM project_milestones
         ORDER BY project_id, (done_at IS NOT NULL), (due_date IS NULL), due_date, created_at",
    )?;
    let rows = stmt.query_map([], |r| Ok((r.get(4)?, from_row(r)?)))?;
    rows.collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    const NOW: &str = "2026-10-20T08:00:00Z";

    fn setup() -> Connection {
        let c = db::open_in_memory().unwrap();
        crate::repo::projects::insert(
            &c,
            "p1",
            "项目",
            crate::repo::settings::MODE_WORK,
            NOW,
        )
        .unwrap();
        c
    }

    #[test]
    fn lists_open_dated_then_undated_then_done() {
        let c = setup();
        insert(&c, "m1", "p1", "方案评审", Some("2026-11-20"), NOW).unwrap();
        insert(&c, "m2", "p1", "无日期", None, NOW).unwrap();
        insert(&c, "m3", "p1", "需求确认", Some("2026-11-01"), NOW).unwrap();
        insert(&c, "m4", "p1", "样机交付", Some("2026-11-10"), NOW).unwrap();
        set_done(&c, "m3", true, NOW).unwrap();

        let ids: Vec<String> = list(&c, "p1").unwrap().into_iter().map(|m| m.id).collect();

        assert_eq!(ids, ["m4", "m1", "m2", "m3"]);
    }

    #[test]
    fn all_pairs_each_milestone_with_its_project() {
        let c = setup();
        crate::repo::projects::insert(
            &c,
            "p2",
            "另一个",
            crate::repo::settings::MODE_WORK,
            NOW,
        )
        .unwrap();
        insert(&c, "m1", "p1", "甲", None, NOW).unwrap();
        insert(&c, "m2", "p2", "乙", None, NOW).unwrap();

        let pairs = all(&c).unwrap();

        assert_eq!(pairs.len(), 2);
        assert_eq!(pairs[0].0, "p1");
        assert_eq!(pairs[0].1.id, "m1");
        assert_eq!(pairs[1].0, "p2");
    }
}
