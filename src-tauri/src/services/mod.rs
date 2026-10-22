use chrono::NaiveDate;

pub mod archive;
pub mod deliverables;
pub mod export;
pub mod people;
pub mod projects;
pub mod shortcut;
pub mod stats;
pub mod status;
pub mod steps;
pub mod tasks;
pub mod week;

pub(crate) fn local_today(now: &str) -> Result<NaiveDate, String> {
    chrono::DateTime::parse_from_rfc3339(now)
        .map(|d| d.with_timezone(&chrono::Local).date_naive())
        .map_err(|e| e.to_string())
}