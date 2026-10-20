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

fn flag(map: &HashMap<String, String>, key: &str, default: bool) -> bool {
    map.get(key).map(|v| v == "true").unwrap_or(default)
}

fn num(map: &HashMap<String, String>, key: &str, default: i64) -> i64 {
    map.get(key)
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

pub fn dto(conn: &Connection) -> rusqlite::Result<SettingsDto> {
    let map = get_all(conn)?;
    Ok(SettingsDto {
        ai_enabled: flag(&map, "ai.enabled", false),
        ai_base_url: map
            .get("ai.base_url")
            .cloned()
            .unwrap_or_else(|| "https://api.deepseek.com".into()),
        ai_model: map
            .get("ai.model")
            .cloned()
            .unwrap_or_else(|| "deepseek-flash".into()),
        ai_has_key: false,
        shortcut: map
            .get("shortcut")
            .cloned()
            .unwrap_or_else(|| "Ctrl+Alt+O".into()),
        autostart: flag(&map, "autostart", true),
        week_start: num(&map, "week_start", 1),
        backup_keep_days: num(&map, "backup_keep_days", 30),
        last_pass_week: map.get("last_pass_week").cloned().unwrap_or_default(),
        shortcut_warning: map
            .get("shortcut_warning")
            .cloned()
            .filter(|v| !v.is_empty()),
    })
}