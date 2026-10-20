use crate::dto::CategoryDto;
use rusqlite::Connection;

pub fn list(conn: &Connection) -> rusqlite::Result<Vec<CategoryDto>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, sort_order FROM categories WHERE deleted_at IS NULL ORDER BY sort_order",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(CategoryDto {
            id: r.get(0)?,
            name: r.get(1)?,
            sort_order: r.get(2)?,
        })
    })?;
    rows.collect()
}
pub fn create(
    conn: &Connection,
    id: &str,
    name: &str,
    sort_order: i64,
    now: &str,
) -> rusqlite::Result<CategoryDto> {
    conn.execute(
        "INSERT INTO categories (id, name, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
        rusqlite::params![id, name, sort_order, now],
    )?;
    conn.query_row(
        "SELECT id, name, sort_order FROM categories WHERE id = ?1",
        [id],
        |r| Ok(CategoryDto { id: r.get(0)?, name: r.get(1)?, sort_order: r.get(2)? }),
    )
}

pub fn rename(conn: &Connection, id: &str, name: &str, now: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE categories SET name = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![name, now, id],
    )?;
    Ok(())
}

pub fn soft_delete(conn: &Connection, id: &str, now: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE categories SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2",
        rusqlite::params![now, id],
    )?;
    Ok(())
}

pub fn next_sort(conn: &Connection) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM categories WHERE deleted_at IS NULL",
        [],
        |r| r.get(0),
    )
}

pub fn reorder(conn: &Connection, ids: &[String], now: &str) -> rusqlite::Result<()> {
    for (i, id) in ids.iter().enumerate() {
        conn.execute(
            "UPDATE categories SET sort_order = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![i as i64, now, id],
        )?;
    }
    Ok(())
}
