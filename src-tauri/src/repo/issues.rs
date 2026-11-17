use crate::dto::{IssueDto, LinkedTaskDto};
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashMap;

pub fn project_of(conn: &Connection, id: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row("SELECT project_id FROM issues WHERE id = ?1", [id], |r| r.get(0))
        .optional()
}

/// The linked requirement; None when the issue is gone, the inner option when unlinked.
pub fn requirement_of(conn: &Connection, id: &str) -> rusqlite::Result<Option<Option<String>>> {
    conn.query_row("SELECT requirement_id FROM issues WHERE id = ?1", [id], |r| r.get(0))
        .optional()
}

pub fn title_of(conn: &Connection, id: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row("SELECT title FROM issues WHERE id = ?1", [id], |r| r.get(0))
        .optional()
}

pub fn insert(
    conn: &Connection,
    id: &str,
    project_id: &str,
    number: &str,
    seq: i64,
    title: &str,
    now: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO issues (id, project_id, number, seq, title, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'open', ?6, ?6)",
        params![id, project_id, number, seq, title, now],
    )?;
    Ok(())
}

pub fn list(conn: &Connection, project_id: &str) -> rusqlite::Result<Vec<IssueDto>> {
    let mut stmt = conn.prepare(
        "SELECT id, project_id, number, requirement_id, title, note, status,
                created_at, resolved_at
         FROM issues WHERE project_id = ?1
         ORDER BY (resolved_at IS NOT NULL), created_at, id",
    )?;
    let rows = stmt.query_map([project_id], |r| {
        Ok(IssueDto {
            id: r.get(0)?,
            project_id: r.get(1)?,
            number: r.get(2)?,
            requirement_id: r.get(3)?,
            title: r.get(4)?,
            note: r.get(5)?,
            status: r.get(6)?,
            created_at: r.get(7)?,
            resolved_at: r.get(8)?,
            tasks: vec![],
        })
    })?;
    let mut issues: Vec<IssueDto> = rows.collect::<rusqlite::Result<_>>()?;
    let mut tasks = conn.prepare(
        "SELECT t.issue_id, t.id, t.title, t.status
         FROM tasks t JOIN issues i ON i.id = t.issue_id
         WHERE i.project_id = ?1 AND t.deleted_at IS NULL AND t.canceled_at IS NULL
         ORDER BY (t.status = 'done'), t.sort_order, t.id",
    )?;
    let rows = tasks.query_map([project_id], |r| {
        Ok((
            r.get::<_, String>(0)?,
            LinkedTaskDto {
                id: r.get(1)?,
                title: r.get(2)?,
                status: r.get(3)?,
            },
        ))
    })?;
    let index: HashMap<String, usize> = issues
        .iter()
        .enumerate()
        .map(|(position, issue)| (issue.id.clone(), position))
        .collect();
    for row in rows {
        let (issue_id, task) = row?;
        if let Some(&position) = index.get(&issue_id) {
            issues[position].tasks.push(task);
        }
    }
    Ok(issues)
}

pub fn dto(conn: &Connection, id: &str) -> rusqlite::Result<IssueDto> {
    let project_id: String = conn.query_row(
        "SELECT project_id FROM issues WHERE id = ?1",
        [id],
        |r| r.get(0),
    )?;
    list(conn, &project_id)?
        .into_iter()
        .find(|issue| issue.id == id)
        .ok_or(rusqlite::Error::QueryReturnedNoRows)
}

pub fn set_title(conn: &Connection, id: &str, title: &str, now: &str) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE issues SET title = ?1, updated_at = ?2 WHERE id = ?3",
        params![title, now, id],
    )
}

pub fn set_note(
    conn: &Connection,
    id: &str,
    note: Option<&str>,
    now: &str,
) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE issues SET note = ?1, updated_at = ?2 WHERE id = ?3",
        params![note, now, id],
    )
}

pub fn set_status(
    conn: &Connection,
    id: &str,
    status: &str,
    resolved_at: Option<&str>,
    now: &str,
) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE issues SET status = ?1, resolved_at = ?2, updated_at = ?3 WHERE id = ?4",
        params![status, resolved_at, now, id],
    )
}

pub fn set_requirement(
    conn: &Connection,
    id: &str,
    requirement_id: Option<&str>,
    now: &str,
) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE issues SET requirement_id = ?1, updated_at = ?2 WHERE id = ?3",
        params![requirement_id, now, id],
    )
}

pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM issues WHERE id = ?1", [id])?;
    Ok(())
}
