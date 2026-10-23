use crate::dto::SettingsDto;
use rusqlite::Connection;
use std::collections::HashMap;

pub fn get_all(conn: &Connection) -> rusqlite::Result<HashMap<String, String>> {
    let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
    rows.collect()
}

pub fn get(conn: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0))
        .map(Some)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(other),
        })
}

pub fn set(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![key, value],
    )?;
    Ok(())
}

/// Only two languages are supported; an absent or unknown value follows the
/// system UI language.
pub fn normalize_language(value: Option<&str>) -> &'static str {
    match value {
        Some("zh") => "zh",
        Some("en") => "en",
        _ => crate::i18n::system_language(),
    }
}

pub fn valid_language(value: &str) -> bool {
    matches!(value, "zh" | "en")
}

pub fn language(conn: &Connection) -> String {
    normalize_language(get(conn, "language").ok().flatten().as_deref()).into()
}

fn flag(map: &HashMap<String, String>, key: &str, default: bool) -> bool {
    map.get(key).map(|v| v == "true").unwrap_or(default)
}

fn num(map: &HashMap<String, String>, key: &str, default: i64) -> i64 {
    map.get(key)
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

fn opt_num(map: &HashMap<String, String>, key: &str) -> Option<i64> {
    map.get(key).and_then(|v| v.parse().ok())
}

pub fn valid_desk_pin(value: &str) -> bool {
    matches!(value, "top" | "bottom")
}

pub fn dto(conn: &Connection) -> rusqlite::Result<SettingsDto> {
    let map = get_all(conn)?;
    Ok(SettingsDto {
        language: normalize_language(map.get("language").map(String::as_str)).into(),
        ai_enabled: flag(&map, "ai.enabled", false),
        ai_base_url: map
            .get("ai.base_url")
            .cloned()
            .unwrap_or_else(|| "https://api.deepseek.com".into()),
        ai_model: map
            .get("ai.model")
            .cloned()
            .unwrap_or_else(|| "deepseek-flash".into()),
        shortcut: map
            .get("shortcut")
            .cloned()
            .unwrap_or_else(|| "Ctrl+Alt+O".into()),
        autostart: flag(&map, "autostart", true),
        backup_keep_days: num(&map, "backup_keep_days", 30),
        backup_error: map
            .get("backup_error")
            .cloned()
            .filter(|v| !v.is_empty()),
        last_pass_week: map.get("last_pass_week").cloned().unwrap_or_default(),
        shortcut_warning: map
            .get("shortcut_warning")
            .cloned()
            .filter(|v| !v.is_empty()),
        theme: map.get("theme").cloned().unwrap_or_else(|| "system".into()),
        desk_enabled: flag(&map, "desk.enabled", false),
        desk_controls: flag(&map, "desk.controls", true),
        desk_pin: map
            .get("desk.pin")
            .filter(|value| valid_desk_pin(value))
            .cloned()
            .unwrap_or_else(|| "top".into()),
        desk_x: opt_num(&map, "desk.x"),
        desk_y: opt_num(&map, "desk.y"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desk_pin_validation() {
        assert!(valid_desk_pin("top"));
        assert!(valid_desk_pin("bottom"));
        assert!(!valid_desk_pin(""));
        assert!(!valid_desk_pin("normal"));
    }
}