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
        "SELECT id, name FROM tags WHERE name = ?1 COLLATE NOCASE AND deleted_at IS NULL LIMIT 1",
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    const NOW: &str = "2026-10-20T08:00:00Z";

    #[test]
    fn tag_lookup_ignores_case() {
        let c = db::open_in_memory().unwrap();
        let first = find_or_create(&c, "t1", "Fix", NOW).unwrap();
        let again = find_or_create(&c, "t2", "fix", NOW).unwrap();

        assert_eq!(first.id, again.id);
        assert_eq!(list(&c).unwrap().len(), 1);
        assert_eq!(list(&c).unwrap()[0].name, "Fix");
    }
}
