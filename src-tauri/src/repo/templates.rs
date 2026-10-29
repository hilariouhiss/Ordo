use crate::dto::{TemplateDto, TemplateInput};
use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

const COLUMNS: &str = "id, name, project_id, category_id, owner_id, priority, effort_minutes, \
                       time_exclusive, note";

fn to_dto(conn: &Connection, row: &rusqlite::Row<'_>) -> rusqlite::Result<TemplateDto> {
    let id: String = row.get(0)?;
    Ok(TemplateDto {
        steps: steps_of(conn, &id)?,
        id,
        name: row.get(1)?,
        project_id: row.get(2)?,
        category_id: row.get(3)?,
        owner_id: row.get(4)?,
        priority: row.get(5)?,
        effort_minutes: row.get(6)?,
        exclusive: row.get::<_, i64>(7)? == 1,
        note: row.get(8)?,
    })
}

fn steps_of(conn: &Connection, template_id: &str) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare_cached(
        "SELECT title FROM template_steps WHERE template_id = ?1 ORDER BY sort_order",
    )?;
    let rows = stmt.query_map([template_id], |r| r.get(0))?;
    rows.collect()
}

pub fn list(conn: &Connection) -> rusqlite::Result<Vec<TemplateDto>> {
    let mut stmt = conn.prepare_cached(
        "SELECT id FROM task_templates WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE",
    )?;
    let ids: Vec<String> = stmt
        .query_map([], |r| r.get(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut out = Vec::with_capacity(ids.len());
    for id in ids {
        if let Some(template) = get(conn, &id)? {
            out.push(template);
        }
    }
    Ok(out)
}

pub fn get(conn: &Connection, id: &str) -> rusqlite::Result<Option<TemplateDto>> {
    let sql = format!("SELECT {COLUMNS} FROM task_templates WHERE id = ?1 AND deleted_at IS NULL");
    conn.prepare_cached(&sql)?
        .query_row([id], |r| to_dto(conn, r))
        .optional()
}

/// Expects a template the service already validated and normalized.
pub fn insert(
    conn: &Connection,
    id: &str,
    template: &TemplateInput,
    now: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO task_templates (id, name, project_id, category_id, owner_id, priority,
                                     effort_minutes, time_exclusive, note, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, COALESCE(?6, 'normal'), COALESCE(?7, 480), ?8, ?9, ?10, ?10)",
        params![
            id,
            template.name.trim(),
            template.project_id.as_deref(),
            template.category_id.as_deref(),
            template.owner_id.as_deref(),
            template.priority.as_deref(),
            template.effort_minutes,
            template.exclusive.unwrap_or(true) as i64,
            template.note.as_deref(),
            now
        ],
    )?;
    replace_steps(conn, id, &template.steps)?;
    Ok(())
}

pub fn update(
    conn: &Connection,
    id: &str,
    template: &TemplateInput,
    now: &str,
) -> rusqlite::Result<usize> {
    let changed = conn.execute(
        "UPDATE task_templates SET name = ?1, project_id = ?2, category_id = ?3, owner_id = ?4,
                priority = COALESCE(?5, priority), effort_minutes = COALESCE(?6, effort_minutes),
                time_exclusive = ?7, note = ?8, updated_at = ?9
         WHERE id = ?10 AND deleted_at IS NULL",
        params![
            template.name.trim(),
            template.project_id.as_deref(),
            template.category_id.as_deref(),
            template.owner_id.as_deref(),
            template.priority.as_deref(),
            template.effort_minutes,
            template.exclusive.unwrap_or(true) as i64,
            template.note.as_deref(),
            now,
            id
        ],
    )?;
    if changed > 0 {
        replace_steps(conn, id, &template.steps)?;
    }
    Ok(changed)
}

pub fn soft_delete(conn: &Connection, id: &str, now: &str) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE task_templates SET deleted_at = ?1, updated_at = ?1
         WHERE id = ?2 AND deleted_at IS NULL",
        params![now, id],
    )
}

/// Wholesale replace: a template's steps are edited as one list.
fn replace_steps(conn: &Connection, template_id: &str, titles: &[String]) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM template_steps WHERE template_id = ?1", [template_id])?;
    for (index, title) in titles.iter().enumerate() {
        conn.execute(
            "INSERT INTO template_steps (id, template_id, title, sort_order) VALUES (?1, ?2, ?3, ?4)",
            params![Uuid::new_v4().to_string(), template_id, title, index as i64],
        )?;
    }
    Ok(())
}
