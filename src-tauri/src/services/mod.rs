use chrono::NaiveDate;
use rusqlite::Connection;

pub mod archive;
pub mod deliverables;
pub mod export;
pub mod people;
pub mod projects;
pub mod rules;
pub mod shortcut;
pub mod stats;
pub mod status;
pub mod templates;
pub mod steps;
pub mod tasks;
pub mod week;

/// Rule and template config may keep pointing at a project archived after the
/// fact; task edits still require a live project.
pub(crate) fn validate_links(
    conn: &Connection,
    project_id: Option<&str>,
    category_id: Option<&str>,
    owner_id: Option<&str>,
) -> Result<(), String> {
    if let Some(id) = project_id {
        if !crate::repo::projects::exists_any(conn, id).map_err(|e| e.to_string())? {
            return Err("invalid_project".into());
        }
    }
    if let Some(id) = category_id {
        if !crate::repo::categories::exists(conn, id).map_err(|e| e.to_string())? {
            return Err("invalid_category".into());
        }
    }
    if let Some(id) = owner_id {
        if !crate::repo::people::exists(conn, id).map_err(|e| e.to_string())? {
            return Err("invalid_owner".into());
        }
    }
    Ok(())
}

pub(crate) fn local_today(now: &str) -> Result<NaiveDate, String> {
    chrono::DateTime::parse_from_rfc3339(now)
        .map(|d| d.with_timezone(&chrono::Local).date_naive())
        .map_err(|e| e.to_string())
}