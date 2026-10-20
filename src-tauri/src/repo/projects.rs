use crate::dto::{PersonDto, ProjectDto, ProjectSummaryDto};
use rusqlite::{params, Connection};

pub fn insert(
    conn: &Connection,
    id: &str,
    name: &str,
    due_date: Option<&str>,
    now: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO projects (id, name, due_date, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
        params![id, name, due_date, now],
    )?;
    Ok(())
}

pub fn update(
    conn: &Connection,
    id: &str,
    name: &str,
    due_date: Option<&str>,
    now: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE projects SET name = ?1, due_date = ?2, updated_at = ?3 WHERE id = ?4",
        params![name, due_date, now, id],
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
    }
    Ok(())
}

pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM tasks WHERE project_id = ?1", [id])?;
    conn.execute("DELETE FROM projects WHERE id = ?1", [id])?;
    Ok(())
}

pub fn member_ids(conn: &Connection, id: &str) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT person_id FROM project_members WHERE project_id = ?1 ORDER BY created_at",
    )?;
    let rows = stmt.query_map([id], |r| r.get(0))?;
    rows.collect()
}

pub fn dto(conn: &Connection, id: &str) -> rusqlite::Result<ProjectDto> {
    let mut project = conn.query_row(
        "SELECT id, name, due_date, archived_at FROM projects WHERE id = ?1 AND deleted_at IS NULL",
        [id],
        |r| {
            Ok(ProjectDto {
                id: r.get(0)?,
                name: r.get(1)?,
                due_date: r.get(2)?,
                archived_at: r.get(3)?,
                member_ids: vec![],
            })
        },
    )?;
    project.member_ids = member_ids(conn, id)?;
    Ok(project)
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
    let pattern = query.map(|q| format!("%{}%", q));
    let mut stmt = conn.prepare(
        "SELECT id FROM projects
         WHERE archived_at IS NOT NULL AND deleted_at IS NULL AND (?1 IS NULL OR name LIKE ?1)
         ORDER BY archived_at DESC",
    )?;
    let ids: Vec<String> = stmt
        .query_map([pattern], |r| r.get(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    ids.iter().map(|id| dto(conn, id)).collect()
}