use crate::dto::{RuleDto, RuleInput};
use rusqlite::{params, Connection, OptionalExtension};

const COLUMNS: &str = "id, title, weekdays, at_time, project_id, category_id, owner_id, priority, \
                       effort_minutes, time_exclusive, enabled";

fn to_dto(row: &rusqlite::Row<'_>) -> rusqlite::Result<RuleDto> {
    let weekdays: String = row.get(2)?;
    Ok(RuleDto {
        id: row.get(0)?,
        title: row.get(1)?,
        weekdays: parse_weekdays(&weekdays),
        at: row.get(3)?,
        project_id: row.get(4)?,
        category_id: row.get(5)?,
        owner_id: row.get(6)?,
        priority: row.get(7)?,
        effort_minutes: row.get(8)?,
        exclusive: row.get::<_, i64>(9)? == 1,
        enabled: row.get::<_, i64>(10)? == 1,
    })
}

pub fn parse_weekdays(raw: &str) -> Vec<u32> {
    raw.split(',')
        .filter_map(|part| part.trim().parse().ok())
        .collect()
}

pub fn format_weekdays(days: &[u32]) -> String {
    days.iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(",")
}

fn query(conn: &Connection, where_clause: &str) -> rusqlite::Result<Vec<RuleDto>> {
    let sql = format!(
        "SELECT {COLUMNS} FROM task_rules WHERE deleted_at IS NULL AND {where_clause} \
         ORDER BY created_at, title"
    );
    let mut stmt = conn.prepare_cached(&sql)?;
    let rows = stmt.query_map([], |r| to_dto(r))?;
    rows.collect()
}

pub fn list(conn: &Connection) -> rusqlite::Result<Vec<RuleDto>> {
    query(conn, "1 = 1")
}

/// The rules the generator looks at.
pub fn live(conn: &Connection) -> rusqlite::Result<Vec<RuleDto>> {
    query(conn, "enabled = 1")
}

/// The local date the rule started existing; a new rule must not backfill before it.
pub fn created_on(conn: &Connection, id: &str) -> rusqlite::Result<Option<String>> {
    let found: Option<Option<String>> = conn
        .query_row(
            "SELECT date(created_at, 'localtime') FROM task_rules WHERE id = ?1",
            [id],
            |r| r.get(0),
        )
        .optional()?;
    Ok(found.flatten())
}

pub fn get(conn: &Connection, id: &str) -> rusqlite::Result<Option<RuleDto>> {
    let sql = format!("SELECT {COLUMNS} FROM task_rules WHERE id = ?1 AND deleted_at IS NULL");
    conn.prepare_cached(&sql)?
        .query_row([id], |r| to_dto(r))
        .optional()
}

/// Expects a rule the service already validated and normalized.
pub fn insert(conn: &Connection, id: &str, rule: &RuleInput, now: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO task_rules (id, title, weekdays, at_time, project_id, category_id, owner_id,
                                 priority, effort_minutes, time_exclusive, enabled, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, COALESCE(?8, 'normal'), COALESCE(?9, 480), ?10, 1, ?11, ?11)",
        params![
            id,
            rule.title.trim(),
            format_weekdays(&rule.weekdays),
            rule.at.trim(),
            rule.project_id.as_deref(),
            rule.category_id.as_deref(),
            rule.owner_id.as_deref(),
            rule.priority.as_deref(),
            rule.effort_minutes,
            rule.exclusive.unwrap_or(false) as i64,
            now
        ],
    )?;
    Ok(())
}

pub fn update(
    conn: &Connection,
    id: &str,
    rule: &RuleInput,
    now: &str,
) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE task_rules SET title = ?1, weekdays = ?2, at_time = ?3, project_id = ?4,
                category_id = ?5, owner_id = ?6, priority = COALESCE(?7, priority),
                effort_minutes = COALESCE(?8, effort_minutes), time_exclusive = ?9, updated_at = ?10
         WHERE id = ?11 AND deleted_at IS NULL",
        params![
            rule.title.trim(),
            format_weekdays(&rule.weekdays),
            rule.at.trim(),
            rule.project_id.as_deref(),
            rule.category_id.as_deref(),
            rule.owner_id.as_deref(),
            rule.priority.as_deref(),
            rule.effort_minutes,
            rule.exclusive.unwrap_or(false) as i64,
            now,
            id
        ],
    )
}

pub fn set_enabled(
    conn: &Connection,
    id: &str,
    enabled: bool,
    now: &str,
) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE task_rules SET enabled = ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL",
        params![enabled as i64, now, id],
    )
}

pub fn soft_delete(conn: &Connection, id: &str, now: &str) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE task_rules SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2 AND deleted_at IS NULL",
        params![now, id],
    )
}
