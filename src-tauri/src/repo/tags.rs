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
