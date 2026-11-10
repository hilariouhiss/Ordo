use crate::dto::ProjectGroupDto;
use rusqlite::{params, Connection, OptionalExtension};

pub fn list(conn: &Connection) -> rusqlite::Result<Vec<ProjectGroupDto>> {
    let mode = crate::repo::settings::mode(conn)?;
    let mut stmt = conn.prepare(&format!(
        "SELECT id, name, contact, phone, note FROM project_groups
         WHERE {} ORDER BY created_at, id",
        crate::repo::scope_eq("project_groups", &mode)
    ))?;
    let rows = stmt.query_map([], |r| {
        Ok(ProjectGroupDto {
            id: r.get(0)?,
            name: r.get(1)?,
            contact: r.get(2)?,
            phone: r.get(3)?,
            note: r.get(4)?,
        })
    })?;
    rows.collect()
}

pub fn get(conn: &Connection, id: &str) -> rusqlite::Result<ProjectGroupDto> {
    conn.query_row(
        "SELECT id, name, contact, phone, note FROM project_groups WHERE id = ?1",
        [id],
        |r| {
            Ok(ProjectGroupDto {
                id: r.get(0)?,
                name: r.get(1)?,
                contact: r.get(2)?,
                phone: r.get(3)?,
                note: r.get(4)?,
            })
        },
    )
}

pub fn find_by_name(
    conn: &Connection,
    name: &str,
    mode: &str,
) -> rusqlite::Result<Option<ProjectGroupDto>> {
    conn.query_row(
        "SELECT id, name, contact, phone, note FROM project_groups
         WHERE name = ?1 AND scope = ?2 LIMIT 1",
        rusqlite::params![name, mode],
        |r| {
            Ok(ProjectGroupDto {
                id: r.get(0)?,
                name: r.get(1)?,
                contact: r.get(2)?,
                phone: r.get(3)?,
                note: r.get(4)?,
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
    scope: &str,
    now: &str,
) -> rusqlite::Result<ProjectGroupDto> {
    conn.execute(
        "INSERT INTO project_groups (id, name, scope, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?4)",
        params![id, name, scope, now],
    )?;
    get(conn, id)
}

/// The world a client belongs to, so a project cannot borrow one from the other side.
pub fn scope_of(conn: &Connection, id: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row("SELECT scope FROM project_groups WHERE id = ?1", [id], |r| r.get(0))
        .optional()
}

pub fn update(
    conn: &Connection,
    id: &str,
    name: &str,
    contact: Option<&str>,
    phone: Option<&str>,
    note: Option<&str>,
    now: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE project_groups
            SET name = ?1, contact = ?2, phone = ?3, note = ?4, updated_at = ?5
          WHERE id = ?6",
        params![name, contact, phone, note, now, id],
    )?;
    Ok(())
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
