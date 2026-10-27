use crate::dto::PersonDto;
use rusqlite::{Connection, OptionalExtension};

pub fn list(conn: &Connection) -> rusqlite::Result<Vec<PersonDto>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, is_me, color FROM people WHERE deleted_at IS NULL ORDER BY is_me DESC, name",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(PersonDto {
            id: r.get(0)?,
            name: r.get(1)?,
            is_me: r.get::<_, i64>(2)? == 1,
            color: r.get(3)?,
        })
    })?;
    rows.collect()
}
pub fn get(conn: &Connection, id: &str) -> rusqlite::Result<PersonDto> {
    conn.query_row(
        "SELECT id, name, is_me, color FROM people WHERE id = ?1 AND deleted_at IS NULL",
        [id],
        |r| {
            Ok(PersonDto {
                id: r.get(0)?,
                name: r.get(1)?,
                is_me: r.get::<_, i64>(2)? == 1,
                color: r.get(3)?,
            })
        },
    )
}

/// The single "me" person, the default owner of a new task.
pub fn me_id(conn: &Connection) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT id FROM people WHERE is_me = 1 AND deleted_at IS NULL LIMIT 1",
        [],
        |r| r.get(0),
    )
    .optional()
}

pub fn exists(conn: &Connection, id: &str) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT 1 FROM people WHERE id = ?1 AND deleted_at IS NULL",
        [id],
        |_| Ok(true),
    )
    .optional()
    .map(|found| found.unwrap_or(false))
}

pub fn find_by_name(conn: &Connection, name: &str) -> rusqlite::Result<Option<PersonDto>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, is_me, color FROM people WHERE name = ?1 AND deleted_at IS NULL LIMIT 1",
    )?;
    let mut rows = stmt.query_map([name], |r| {
        Ok(PersonDto {
            id: r.get(0)?,
            name: r.get(1)?,
            is_me: r.get::<_, i64>(2)? == 1,
            color: r.get(3)?,
        })
    })?;
    rows.next().transpose()
}

pub fn create(conn: &Connection, id: &str, name: &str, now: &str) -> rusqlite::Result<PersonDto> {
    conn.execute(
        "INSERT INTO people (id, name, is_me, color, created_at, updated_at) VALUES (?1, ?2, 0, NULL, ?3, ?3)",
        rusqlite::params![id, name, now],
    )?;
    get(conn, id)
}

pub fn rename(conn: &Connection, id: &str, name: &str, now: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE people SET name = ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL",
        rusqlite::params![name, now, id],
    )?;
    Ok(())
}

pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM people WHERE id = ?1", [id])?;
    Ok(())
}
