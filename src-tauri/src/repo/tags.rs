use crate::dto::TagDto;
use rusqlite::Connection;

pub fn list(conn: &Connection) -> rusqlite::Result<Vec<TagDto>> {
    let mut stmt =
        conn.prepare("SELECT id, name FROM tags WHERE deleted_at IS NULL ORDER BY name")?;
    let rows = stmt.query_map([], |r| {
        Ok(TagDto {
            id: r.get(0)?,
            name: r.get(1)?,
        })
    })?;
    rows.collect()
}
pub fn create(conn: &Connection, id: &str, name: &str, now: &str) -> rusqlite::Result<TagDto> {
    conn.execute(
        "INSERT INTO tags (id, name, created_at) VALUES (?1, ?2, ?3)",
        rusqlite::params![id, name, now],
    )?;
    Ok(TagDto { id: id.to_string(), name: name.to_string() })
}

pub fn find_or_create(conn: &Connection, id: &str, name: &str, now: &str) -> rusqlite::Result<TagDto> {
    let existing = conn.query_row(
        "SELECT id, name FROM tags WHERE name = ?1 AND deleted_at IS NULL LIMIT 1",
        [name],
        |r| Ok(TagDto { id: r.get(0)?, name: r.get(1)? }),
    );
    match existing {
        Ok(tag) => Ok(tag),
        Err(rusqlite::Error::QueryReturnedNoRows) => create(conn, id, name, now),
        Err(e) => Err(e),
    }
}

pub fn soft_delete(conn: &Connection, id: &str, now: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE tags SET deleted_at = ?1 WHERE id = ?2",
        rusqlite::params![now, id],
    )?;
    Ok(())
}
