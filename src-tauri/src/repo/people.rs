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
