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
