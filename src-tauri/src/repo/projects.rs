use crate::dto::{PersonDto, ProjectDto, ProjectMemberDto};
use rusqlite::{params, Connection, OptionalExtension};

pub fn insert(conn: &Connection, id: &str, name: &str, now: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO projects (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
        params![id, name, now],
    )?;
    Ok(())
}

pub fn update(
    conn: &Connection,
    id: &str,
    name: &str,
    group_id: Option<&str>,
    priority: &str,
    now: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE projects SET name = ?1, group_id = ?2, priority = ?3, updated_at = ?4
         WHERE id = ?5",
        params![name, group_id, priority, now, id],
    )?;
    Ok(())
}

pub fn set_group(
    conn: &Connection,
    id: &str,
    group_id: &str,
    now: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE projects SET group_id = ?1, updated_at = ?2 WHERE id = ?3",
        params![group_id, now, id],
    )?;
    Ok(())
}

pub fn set_archived(conn: &Connection, id: &str, archived: bool, now: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE projects SET archived_at = ?1, updated_at = ?2 WHERE id = ?3",
        params![if archived { Some(now) } else { None }, now, id],
    )?;
    if archived {
        conn.execute(
            "UPDATE tasks SET in_week = 0 WHERE project_id = ?1 AND deleted_at IS NULL",
            [id],
        )?;
    } else {
        // One UPDATE would give every restored task the same sort_order (SQLite evaluates
        // the MAX subquery once), leaving their order to the UUID tiebreak.
        let restoring: Vec<String> = {
            let mut stmt = conn.prepare(
                "SELECT id FROM tasks
                 WHERE project_id = ?1 AND deleted_at IS NULL AND canceled_at IS NULL
                   AND archived_at IS NULL AND status <> 'done' AND suspended = 0
                 ORDER BY sort_order, id",
            )?;
            stmt.query_map([id], |r| r.get(0))?
                .collect::<rusqlite::Result<_>>()?
        };
        let base: i64 = conn.query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM tasks",
            [],
            |r| r.get(0),
        )?;
        let tx = conn.unchecked_transaction()?;
        for (offset, task_id) in restoring.iter().enumerate() {
            tx.execute(
                "UPDATE tasks SET in_week = 1, sort_order = ?1 WHERE id = ?2",
                params![base + offset as i64, task_id],
            )?;
        }
        tx.commit()?;
    }
    Ok(())
}

pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM tasks WHERE project_id = ?1", [id])?;
    conn.execute("DELETE FROM projects WHERE id = ?1", [id])?;
    Ok(())
}

pub fn members(conn: &Connection, id: &str) -> rusqlite::Result<Vec<ProjectMemberDto>> {
    let mut stmt = conn.prepare(
        "SELECT person_id, category_id FROM project_members
         WHERE project_id = ?1 ORDER BY created_at",
    )?;
    let rows = stmt.query_map([id], |r| {
        Ok(ProjectMemberDto {
            person_id: r.get(0)?,
            category_id: r.get(1)?,
        })
    })?;
    rows.collect()
}

pub fn dto(conn: &Connection, id: &str) -> rusqlite::Result<ProjectDto> {
    let mut project = conn.query_row(
        "SELECT id, name, group_id, priority, archived_at
         FROM projects WHERE id = ?1 AND deleted_at IS NULL",
        [id],
        |r| {
            Ok(ProjectDto {
                id: r.get(0)?,
                name: r.get(1)?,
                group_id: r.get(2)?,
                priority: r.get(3)?,
                archived_at: r.get(4)?,
                members: vec![],
            })
        },
    )?;
    project.members = members(conn, id)?;
    Ok(project)
}

pub fn exists(conn: &Connection, id: &str) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT 1 FROM projects
         WHERE id = ?1 AND deleted_at IS NULL AND archived_at IS NULL",
        [id],
        |_| Ok(true),
    )
    .optional()
    .map(|found| found.unwrap_or(false))
}

pub fn list(conn: &Connection) -> rusqlite::Result<Vec<ProjectDto>> {
    let mut stmt = conn.prepare(
        "SELECT id FROM projects WHERE archived_at IS NULL AND deleted_at IS NULL ORDER BY created_at",
    )?;
    let ids: Vec<String> = stmt
        .query_map([], |r| r.get(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    ids.iter().map(|id| dto(conn, id)).collect()
}

pub fn add_member(
    conn: &Connection,
    project_id: &str,
    person_id: &str,
    now: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO project_members (project_id, person_id, created_at) VALUES (?1, ?2, ?3)",
        params![project_id, person_id, now],
    )?;
    Ok(())
}

pub fn remove_member(conn: &Connection, project_id: &str, person_id: &str) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM project_members WHERE project_id = ?1 AND person_id = ?2",
        params![project_id, person_id],
    )?;
    Ok(())
}

pub fn is_member(
    conn: &Connection,
    project_id: &str,
    person_id: &str,
) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT 1 FROM project_members WHERE project_id = ?1 AND person_id = ?2",
        params![project_id, person_id],
        |_| Ok(true),
    )
    .optional()
    .map(|found| found.unwrap_or(false))
}

/// The member responsible for a specialty, ignoring deleted people and categories.
pub fn category_owner(
    conn: &Connection,
    project_id: &str,
    category_id: &str,
) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT m.person_id
         FROM project_members m
         JOIN people p ON p.id = m.person_id AND p.deleted_at IS NULL
         JOIN categories c ON c.id = m.category_id AND c.deleted_at IS NULL
         WHERE m.project_id = ?1 AND m.category_id = ?2
         LIMIT 1",
        params![project_id, category_id],
        |r| r.get(0),
    )
    .optional()
}

/// Moves a specialty to this member and hands it the tasks that were still default-owned
/// or owned by the previous specialty owner.
pub fn set_member_category(
    conn: &Connection,
    project_id: &str,
    person_id: &str,
    category_id: Option<&str>,
    now: &str,
) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    let previous = match category_id {
        Some(category) => category_owner(&tx, project_id, category)?,
        None => None,
    };
    if let Some(category) = category_id {
        tx.execute(
            "UPDATE project_members SET category_id = NULL
             WHERE project_id = ?1 AND category_id = ?2 AND person_id <> ?3",
            params![project_id, category, person_id],
        )?;
    }
    tx.execute(
        "UPDATE project_members SET category_id = ?1 WHERE project_id = ?2 AND person_id = ?3",
        params![category_id, project_id, person_id],
    )?;
    if let Some(category) = category_id {
        tx.execute(
            "UPDATE tasks SET owner_id = ?1, updated_at = ?2
             WHERE project_id = ?3 AND category_id = ?4
               AND deleted_at IS NULL AND archived_at IS NULL AND canceled_at IS NULL
               AND status <> 'done'
               AND (owner_id IS NULL
                    OR owner_id = (SELECT id FROM people WHERE is_me = 1 LIMIT 1)
                    OR (?5 IS NOT NULL AND owner_id = ?5))",
            params![person_id, now, project_id, category, previous],
        )?;
    }
    tx.commit()
}

pub fn member_people(conn: &Connection, project_id: &str) -> rusqlite::Result<Vec<PersonDto>> {
    let mut stmt = conn.prepare(
        "SELECT p.id, p.name, p.is_me, p.color
         FROM people p JOIN project_members m ON m.person_id = p.id
         WHERE m.project_id = ?1 AND p.deleted_at IS NULL
         ORDER BY p.is_me DESC, p.name",
    )?;
    let rows = stmt.query_map([project_id], |r| {
        Ok(PersonDto {
            id: r.get(0)?,
            name: r.get(1)?,
            is_me: r.get::<_, i64>(2)? == 1,
            color: r.get(3)?,
        })
    })?;
    rows.collect()
}
pub fn list_archived(conn: &Connection, query: Option<&str>) -> rusqlite::Result<Vec<ProjectDto>> {
    let pattern = query.map(crate::repo::like_pattern);
    let mut stmt = conn.prepare(
        "SELECT id FROM projects
         WHERE archived_at IS NOT NULL AND deleted_at IS NULL AND (?1 IS NULL OR name LIKE ?1 ESCAPE '!')
         ORDER BY archived_at DESC",
    )?;
    let ids: Vec<String> = stmt
        .query_map([pattern], |r| r.get(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    ids.iter().map(|id| dto(conn, id)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    const NOW: &str = "2026-10-20T08:00:00Z";

    #[test]
    fn archiving_stamps_the_time_and_restoring_clears_it() {
        let c = db::open_in_memory().unwrap();
        insert(&c, "p1", "项目", NOW).unwrap();

        set_archived(&c, "p1", true, NOW).unwrap();
        assert_eq!(dto(&c, "p1").unwrap().archived_at.as_deref(), Some(NOW));

        set_archived(&c, "p1", false, "2026-10-21T08:00:00Z").unwrap();
        assert!(dto(&c, "p1").unwrap().archived_at.is_none());
    }
}