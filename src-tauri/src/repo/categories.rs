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

/// Soft-deletes a category and takes it off its tasks in one transaction.
pub fn soft_delete_and_detach(conn: &Connection, id: &str, now: &str) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE tasks SET category_id = NULL, updated_at = ?1
         WHERE category_id = ?2 AND deleted_at IS NULL",
        rusqlite::params![now, id],
    )?;
    soft_delete(&tx, id, now)?;
    tx.commit()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    const NOW: &str = "2026-10-20T08:00:00Z";

    #[test]
    fn deleting_a_category_detaches_its_tasks() {
        let c = db::open_in_memory().unwrap();
        let software = list(&c)
            .unwrap()
            .into_iter()
            .find(|category| category.name == "软件")
            .unwrap();
        let docs = list(&c)
            .unwrap()
            .into_iter()
            .find(|category| category.name == "资料")
            .unwrap();
        crate::services::week::capture(&c, "交底", NOW, "t1").unwrap();
        crate::services::week::capture(&c, "别的", NOW, "t2").unwrap();
        c.execute(
            "UPDATE tasks SET category_id = ?1 WHERE id = 't1'",
            rusqlite::params![software.id],
        )
        .unwrap();
        c.execute(
            "UPDATE tasks SET category_id = ?1 WHERE id = 't2'",
            rusqlite::params![docs.id],
        )
        .unwrap();

        soft_delete_and_detach(&c, &software.id, NOW).unwrap();

        let detached: Option<String> = c
            .query_row("SELECT category_id FROM tasks WHERE id = 't1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert!(detached.is_none());
        assert!(list(&c).unwrap().iter().all(|category| category.id != software.id));
        let kept: Option<String> = c
            .query_row("SELECT category_id FROM tasks WHERE id = 't2'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(kept.as_deref(), Some(docs.id.as_str()));
    }
}
