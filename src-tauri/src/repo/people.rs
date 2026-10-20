use crate::dto::PersonDto;
use rusqlite::Connection;

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
