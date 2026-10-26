use crate::dto::ProjectGroupDto;
use rusqlite::{params, Connection, OptionalExtension};

pub fn list(conn: &Connection) -> rusqlite::Result<Vec<ProjectGroupDto>> {
    let mut stmt =
        conn.prepare("SELECT id, name FROM project_groups ORDER BY created_at, id")?;
    let rows = stmt.query_map([], |r| {
        Ok(ProjectGroupDto {
            id: r.get(0)?,
            name: r.get(1)?,
        })
    })?;
    rows.collect()
}

pub fn get(conn: &Connection, id: &str) -> rusqlite::Result<ProjectGroupDto> {
    conn.query_row(
        "SELECT id, name FROM project_groups WHERE id = ?1",
        [id],
        |r| {
            Ok(ProjectGroupDto {
                id: r.get(0)?,
                name: r.get(1)?,
            })
        },
    )
}

pub fn find_by_name(conn: &Connection, name: &str) -> rusqlite::Result<Option<ProjectGroupDto>> {
    conn.query_row(
        "SELECT id, name FROM project_groups WHERE name = ?1 LIMIT 1",
        [name],
        |r| {
            Ok(ProjectGroupDto {
                id: r.get(0)?,
                name: r.get(1)?,
            })
        },
    )
    .optional()
}

pub fn exists(conn: &Connection, id: &str) -> rusqlite::Result<bool> {
    conn.query_row("SELECT 1 FROM project_groups WHERE id = ?1", [id], |_| {
        Ok(true)
    })
    .optional()
    .map(|found| found.unwrap_or(false))
}

pub fn insert(
    conn: &Connection,
    id: &str,
    name: &str,
    now: &str,
) -> rusqlite::Result<ProjectGroupDto> {
    conn.execute(
        "INSERT INTO project_groups (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
        params![id, name, now],
    )?;
    get(conn, id)
}

pub fn rename(conn: &Connection, id: &str, name: &str, now: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE project_groups SET name = ?1, updated_at = ?2 WHERE id = ?3",
        params![name, now, id],
    )?;
    Ok(())
}

pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute("UPDATE projects SET group_id = NULL WHERE group_id = ?1", [id])?;
    tx.execute("DELETE FROM project_groups WHERE id = ?1", [id])?;
    tx.commit()
}
