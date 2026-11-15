use crate::dto::PersonDto;
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashMap;

/// Every person's 职责 in one pass, so the list does not query per row.
fn category_map(conn: &Connection) -> rusqlite::Result<HashMap<String, Vec<String>>> {
    let mut stmt = conn.prepare(
        "SELECT pc.person_id, pc.category_id
           FROM person_categories pc
           JOIN categories c ON c.id = pc.category_id AND c.deleted_at IS NULL
          ORDER BY c.sort_order, c.id",
    )?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
    let mut map: HashMap<String, Vec<String>> = HashMap::new();
    for row in rows {
        let (person_id, category_id) = row?;
        map.entry(person_id).or_default().push(category_id);
    }
    Ok(map)
}

/// The categories one person is responsible for, in category order.
pub fn categories(conn: &Connection, person_id: &str) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT pc.category_id
           FROM person_categories pc
           JOIN categories c ON c.id = pc.category_id AND c.deleted_at IS NULL
          WHERE pc.person_id = ?1
          ORDER BY c.sort_order, c.id",
    )?;
    let rows = stmt.query_map([person_id], |r| r.get(0))?;
    rows.collect()
}

/// The same write without opening a transaction, for a caller that already holds one.
pub fn replace_categories(
    conn: &Connection,
    person_id: &str,
    category_ids: &[String],
) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM person_categories WHERE person_id = ?1",
        [person_id],
    )?;
    for category_id in category_ids {
        conn.execute(
            "INSERT OR IGNORE INTO person_categories (person_id, category_id) VALUES (?1, ?2)",
            params![person_id, category_id],
        )?;
    }
    Ok(())
}

pub fn list(conn: &Connection) -> rusqlite::Result<Vec<PersonDto>> {
    let mut responsibilities = category_map(conn)?;
    let mut stmt = conn.prepare(
        "SELECT id, name, is_me FROM people WHERE deleted_at IS NULL ORDER BY is_me DESC, name",
    )?;
    let rows = stmt.query_map([], |r| {
        let id: String = r.get(0)?;
        Ok(PersonDto {
            name: r.get(1)?,
            is_me: r.get::<_, i64>(2)? == 1,
            category_ids: responsibilities.remove(&id).unwrap_or_default(),
            id,
        })
    })?;
    rows.collect()
}
pub fn get(conn: &Connection, id: &str) -> rusqlite::Result<PersonDto> {
    conn.query_row(
        "SELECT id, name, is_me FROM people WHERE id = ?1 AND deleted_at IS NULL",
        [id],
        |r| {
            let id: String = r.get(0)?;
            Ok(PersonDto {
                name: r.get(1)?,
                is_me: r.get::<_, i64>(2)? == 1,
                category_ids: categories(conn, &id)?,
                id,
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
        "SELECT id, name, is_me FROM people WHERE name = ?1 AND deleted_at IS NULL LIMIT 1",
    )?;
    let mut rows = stmt.query_map([name], |r| {
        let id: String = r.get(0)?;
        Ok(PersonDto {
            name: r.get(1)?,
            is_me: r.get::<_, i64>(2)? == 1,
            category_ids: categories(conn, &id)?,
            id,
        })
    })?;
    rows.next().transpose()
}

pub fn create(conn: &Connection, id: &str, name: &str, now: &str) -> rusqlite::Result<PersonDto> {
    conn.execute(
        "INSERT INTO people (id, name, is_me, created_at, updated_at) VALUES (?1, ?2, 0, ?3, ?3)",
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
