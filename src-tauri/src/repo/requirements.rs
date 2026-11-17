use crate::dto::{
    LinkedIssueDto, LinkedTaskDto, RequirementChangeDto, RequirementDto,
    RequirementSectionRefDto, RequirementStatusDto,
};
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashMap;

pub fn exists(conn: &Connection, id: &str) -> rusqlite::Result<bool> {
    conn.query_row("SELECT 1 FROM requirements WHERE id = ?1", [id], |_| Ok(true))
        .optional()
        .map(|found| found.unwrap_or(false))
}

pub fn project_of(conn: &Connection, id: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row("SELECT project_id FROM requirements WHERE id = ?1", [id], |r| {
        r.get(0)
    })
    .optional()
}

/// The stored status; None when the requirement is gone. The inner option is the
/// nullable status_id, kept as null only if a cascade ever orphaned it.
pub fn status_of(conn: &Connection, id: &str) -> rusqlite::Result<Option<Option<String>>> {
    conn.query_row("SELECT status_id FROM requirements WHERE id = ?1", [id], |r| {
        r.get(0)
    })
    .optional()
}

pub fn title_of(conn: &Connection, id: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row("SELECT title FROM requirements WHERE id = ?1", [id], |r| r.get(0))
        .optional()
}

pub fn insert(
    conn: &Connection,
    id: &str,
    project_id: &str,
    number: &str,
    seq: i64,
    status_id: &str,
    title: &str,
    now: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO requirements
           (id, project_id, number, seq, status_id, title, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
        params![id, project_id, number, seq, status_id, title, now],
    )?;
    Ok(())
}

pub fn list(conn: &Connection, project_id: &str) -> rusqlite::Result<Vec<RequirementDto>> {
    let mut stmt = conn.prepare(
        "SELECT id, project_id, number, title, status_id, category_id, owner_id
         FROM requirements WHERE project_id = ?1 ORDER BY created_at, id",
    )?;
    let rows = stmt.query_map([project_id], |r| {
        Ok(RequirementDto {
            id: r.get(0)?,
            project_id: r.get(1)?,
            number: r.get(2)?,
            title: r.get(3)?,
            status_id: r.get(4)?,
            category_id: r.get(5)?,
            owner_id: r.get(6)?,
            sections: vec![],
            tasks: vec![],
            issues: vec![],
        })
    })?;
    let mut list: Vec<RequirementDto> = rows.collect::<rusqlite::Result<_>>()?;
    attach_sections(conn, project_id, &mut list)?;
    attach_tasks(conn, project_id, &mut list)?;
    attach_issues(conn, project_id, &mut list)?;
    Ok(list)
}

/// One requirement in full. The project's list is loaded and the row picked out: a
/// project holds a handful of them, and it keeps the child queries in one place.
pub fn dto(conn: &Connection, id: &str) -> rusqlite::Result<RequirementDto> {
    let project_id: String = conn.query_row(
        "SELECT project_id FROM requirements WHERE id = ?1",
        [id],
        |r| r.get(0),
    )?;
    list(conn, &project_id)?
        .into_iter()
        .find(|requirement| requirement.id == id)
        .ok_or(rusqlite::Error::QueryReturnedNoRows)
}

fn attach_sections(
    conn: &Connection,
    project_id: &str,
    list: &mut [RequirementDto],
) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare(
        "SELECT rs.requirement_id, ds.id, ds.title, pd.id, pd.title, rs.quote
         FROM requirement_sections rs
         JOIN document_sections ds ON ds.id = rs.section_id
         JOIN project_documents pd ON pd.id = ds.document_id
         WHERE pd.project_id = ?1
         ORDER BY rs.created_at, ds.sort_order, ds.id",
    )?;
    let rows = stmt.query_map([project_id], |r| {
        Ok((
            r.get::<_, String>(0)?,
            RequirementSectionRefDto {
                section_id: r.get(1)?,
                section_title: r.get(2)?,
                document_id: r.get(3)?,
                document_title: r.get(4)?,
                quote: r.get(5)?,
            },
        ))
    })?;
    let index: HashMap<String, usize> = list
        .iter()
        .enumerate()
        .map(|(position, requirement)| (requirement.id.clone(), position))
        .collect();
    for row in rows {
        let (requirement_id, section) = row?;
        if let Some(&position) = index.get(&requirement_id) {
            list[position].sections.push(section);
        }
    }
    Ok(())
}

fn attach_tasks(
    conn: &Connection,
    project_id: &str,
    list: &mut [RequirementDto],
) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare(
        "SELECT t.requirement_id, t.id, t.title, t.status
         FROM tasks t JOIN requirements r ON r.id = t.requirement_id
         WHERE r.project_id = ?1 AND t.deleted_at IS NULL AND t.canceled_at IS NULL
         ORDER BY (t.status = 'done'), t.sort_order, t.id",
    )?;
    let rows = stmt.query_map([project_id], |r| {
        Ok((
            r.get::<_, String>(0)?,
            LinkedTaskDto {
                id: r.get(1)?,
                title: r.get(2)?,
                status: r.get(3)?,
            },
        ))
    })?;
    let index: HashMap<String, usize> = list
        .iter()
        .enumerate()
        .map(|(position, requirement)| (requirement.id.clone(), position))
        .collect();
    for row in rows {
        let (requirement_id, task) = row?;
        if let Some(&position) = index.get(&requirement_id) {
            list[position].tasks.push(task);
        }
    }
    Ok(())
}

fn attach_issues(
    conn: &Connection,
    project_id: &str,
    list: &mut [RequirementDto],
) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare(
        "SELECT requirement_id, id, title, status FROM issues
         WHERE project_id = ?1 AND requirement_id IS NOT NULL
         ORDER BY created_at, id",
    )?;
    let rows = stmt.query_map([project_id], |r| {
        Ok((
            r.get::<_, String>(0)?,
            LinkedIssueDto {
                id: r.get(1)?,
                title: r.get(2)?,
                status: r.get(3)?,
            },
        ))
    })?;
    let index: HashMap<String, usize> = list
        .iter()
        .enumerate()
        .map(|(position, requirement)| (requirement.id.clone(), position))
        .collect();
    for row in rows {
        let (requirement_id, issue) = row?;
        if let Some(&position) = index.get(&requirement_id) {
            list[position].issues.push(issue);
        }
    }
    Ok(())
}

pub fn set_title(conn: &Connection, id: &str, title: &str, now: &str) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE requirements SET title = ?1, updated_at = ?2 WHERE id = ?3",
        params![title, now, id],
    )
}

pub fn set_category(
    conn: &Connection,
    id: &str,
    category_id: Option<&str>,
    now: &str,
) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE requirements SET category_id = ?1, updated_at = ?2 WHERE id = ?3",
        params![category_id, now, id],
    )
}

pub fn set_owner(
    conn: &Connection,
    id: &str,
    owner_id: Option<&str>,
    now: &str,
) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE requirements SET owner_id = ?1, updated_at = ?2 WHERE id = ?3",
        params![owner_id, now, id],
    )
}

pub fn set_status(
    conn: &Connection,
    id: &str,
    status_id: &str,
    now: &str,
) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE requirements SET status_id = ?1, updated_at = ?2 WHERE id = ?3",
        params![status_id, now, id],
    )
}

pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM requirements WHERE id = ?1", [id])?;
    Ok(())
}

pub fn list_statuses(
    conn: &Connection,
    project_id: &str,
) -> rusqlite::Result<Vec<RequirementStatusDto>> {
    let mut stmt = conn.prepare(
        "SELECT id, name FROM requirement_statuses
         WHERE project_id = ?1 ORDER BY sort_order, id",
    )?;
    let rows = stmt.query_map([project_id], |r| {
        Ok(RequirementStatusDto {
            id: r.get(0)?,
            name: r.get(1)?,
        })
    })?;
    rows.collect()
}

pub fn status_count(conn: &Connection, project_id: &str) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM requirement_statuses WHERE project_id = ?1",
        [project_id],
        |r| r.get(0),
    )
}

pub fn insert_status(
    conn: &Connection,
    id: &str,
    project_id: &str,
    name: &str,
    sort_order: i64,
    now: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO requirement_statuses (id, project_id, name, sort_order, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, project_id, name, sort_order, now],
    )?;
    Ok(())
}

pub fn update_status(
    conn: &Connection,
    id: &str,
    name: &str,
    sort_order: i64,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE requirement_statuses SET name = ?1, sort_order = ?2 WHERE id = ?3",
        params![name, sort_order, id],
    )?;
    Ok(())
}

pub fn delete_status(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM requirement_statuses WHERE id = ?1", [id])?;
    Ok(())
}

/// Moves every requirement in a deleted status to the surviving one; returns how many
/// moved so the caller can write their change rows.
pub fn reassign_status(
    conn: &Connection,
    project_id: &str,
    from: &str,
    to: &str,
    now: &str,
) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE requirements SET status_id = ?1, updated_at = ?2
         WHERE project_id = ?3 AND status_id = ?4",
        params![to, now, project_id, from],
    )
}

/// Requirements whose status was orphaned by an older build fall back to the first
/// surviving status of their project.
pub fn clear_null_statuses(
    conn: &Connection,
    project_id: &str,
    fallback: &str,
    now: &str,
) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE requirements SET status_id = ?1, updated_at = ?2
         WHERE project_id = ?3 AND status_id IS NULL",
        params![fallback, now, project_id],
    )
}

/// The requirements sitting in one status, so a status edit can log each move.
pub fn in_status(
    conn: &Connection,
    project_id: &str,
    status_id: &str,
) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT id FROM requirements
         WHERE project_id = ?1 AND status_id = ?2 ORDER BY created_at, id",
    )?;
    let rows = stmt.query_map(params![project_id, status_id], |r| r.get(0))?;
    rows.collect()
}

pub fn link_section(
    conn: &Connection,
    requirement_id: &str,
    section_id: &str,
    quote: Option<&str>,
    now: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO requirement_sections
           (requirement_id, section_id, quote, created_at)
         VALUES (?1, ?2, ?3, ?4)",
        params![requirement_id, section_id, quote, now],
    )?;
    Ok(())
}

/// The project and display names behind one chapter link, or None when it is gone.
pub fn section_info(
    conn: &Connection,
    section_id: &str,
) -> rusqlite::Result<Option<(String, String, String, String)>> {
    conn.query_row(
        "SELECT pd.project_id, pd.id, pd.title, ds.title
         FROM document_sections ds JOIN project_documents pd ON pd.id = ds.document_id
         WHERE ds.id = ?1",
        [section_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    )
    .optional()
}

pub fn insert_change(
    conn: &Connection,
    requirement_id: &str,
    kind: &str,
    from_value: Option<&str>,
    to_value: Option<&str>,
    now: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO requirement_changes
           (id, requirement_id, kind, from_value, to_value, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            uuid::Uuid::new_v4().to_string(),
            requirement_id,
            kind,
            from_value,
            to_value,
            now
        ],
    )?;
    Ok(())
}

pub fn changes(
    conn: &Connection,
    requirement_id: &str,
) -> rusqlite::Result<Vec<RequirementChangeDto>> {
    let mut stmt = conn.prepare(
        "SELECT id, kind, from_value, to_value, created_at FROM requirement_changes
         WHERE requirement_id = ?1 ORDER BY created_at DESC, id DESC",
    )?;
    let rows = stmt.query_map([requirement_id], |r| {
        Ok(RequirementChangeDto {
            id: r.get(0)?,
            kind: r.get(1)?,
            from_value: r.get(2)?,
            to_value: r.get(3)?,
            created_at: r.get(4)?,
        })
    })?;
    rows.collect()
}

/// True when this requirement already logged a status change at this exact stamp.
/// The parent and child of one completion share a stamp; this keeps that one event
/// from advancing the pipeline twice.
pub fn status_changed_at(
    conn: &Connection,
    requirement_id: &str,
    now: &str,
) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT 1 FROM requirement_changes
         WHERE requirement_id = ?1 AND created_at = ?2 AND kind IN ('status','status_auto')",
        params![requirement_id, now],
        |_| Ok(true),
    )
    .optional()
    .map(|found| found.unwrap_or(false))
}
