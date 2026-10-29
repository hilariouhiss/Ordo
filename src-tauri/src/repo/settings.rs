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

pub fn valid_task_group_by(value: &str) -> bool {
    matches!(
        value,
        "none" | "project" | "category" | "tag" | "owner" | "priority"
    )
}

/// The endpoint receives the API key, so it has to be https; a local server may be http.
pub fn valid_ai_base_url(value: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(value.trim()) else {
        return false;
    };
    match url.scheme() {
        "https" => url.host_str().is_some(),
        "http" => matches!(
            url.host_str(),
            Some("localhost") | Some("127.0.0.1") | Some("[::1]")
        ),
        _ => false,
    }
}

/// The main window starts as the week widget when this is on.
pub fn desk_enabled(conn: &Connection) -> bool {
    get(conn, "desk.enabled")
        .ok()
        .flatten()
        .as_deref()
        == Some("true")
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
        desk_shortcut: map
            .get("desk.shortcut")
            .cloned()
            .unwrap_or_else(|| "Ctrl+Alt+W".into()),
        main_shortcut: map
            .get("main.shortcut")
            .cloned()
            .unwrap_or_else(|| "Ctrl+Alt+M".into()),
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
        desk_shortcut_warning: map
            .get("desk.shortcut_warning")
            .cloned()
            .filter(|v| !v.is_empty()),
        main_shortcut_warning: map
            .get("main.shortcut_warning")
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
        tasks_group_by: map
            .get("tasks.group_by")
            .filter(|value| valid_task_group_by(value))
            .cloned()
            .unwrap_or_else(|| "none".into()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ai_base_url_is_https_or_local() {
        assert!(valid_ai_base_url("https://api.deepseek.com"));
        assert!(valid_ai_base_url(" https://api.deepseek.com/v1 "));
        assert!(valid_ai_base_url("http://localhost:11434"));
        assert!(valid_ai_base_url("http://127.0.0.1:8080/v1"));
        assert!(valid_ai_base_url("http://[::1]:8080"));

        // The key follows this URL, so cleartext and typos are refused.
        assert!(!valid_ai_base_url("http://api.deepseek.com"));
        assert!(!valid_ai_base_url("https://"));
        assert!(!valid_ai_base_url("api.deepseek.com"));
        assert!(!valid_ai_base_url("ftp://api.deepseek.com"));
        assert!(!valid_ai_base_url(""));
    }

    #[test]
    fn shortcut_settings_default_and_roundtrip() {
        let c = crate::db::open_in_memory().unwrap();
        let s = dto(&c).unwrap();
        assert_eq!(s.shortcut, "Ctrl+Alt+O");
        assert_eq!(s.desk_shortcut, "Ctrl+Alt+W");
        assert_eq!(s.main_shortcut, "Ctrl+Alt+M");
        assert!(s.desk_shortcut_warning.is_none());
        assert!(s.main_shortcut_warning.is_none());

        set(&c, "desk.shortcut", "Ctrl+Alt+D").unwrap();
        set(&c, "main.shortcut", "Ctrl+Alt+N").unwrap();
        set(&c, "main.shortcut_warning", "taken").unwrap();
        let s = dto(&c).unwrap();
        assert_eq!(s.desk_shortcut, "Ctrl+Alt+D");
        assert_eq!(s.main_shortcut, "Ctrl+Alt+N");
        assert_eq!(s.main_shortcut_warning.as_deref(), Some("taken"));
    }

    #[test]
    fn desk_pin_validation() {
        assert!(valid_desk_pin("top"));
        assert!(valid_desk_pin("bottom"));
        assert!(!valid_desk_pin(""));
        assert!(!valid_desk_pin("normal"));
    }

    #[test]
    fn task_group_by_defaults_and_roundtrips() {
        let c = crate::db::open_in_memory().unwrap();
        assert_eq!(dto(&c).unwrap().tasks_group_by, "none");

        for value in ["none", "project", "category", "tag", "owner", "priority"] {
            assert!(valid_task_group_by(value));
            set(&c, "tasks.group_by", value).unwrap();
            assert_eq!(dto(&c).unwrap().tasks_group_by, value);
        }

        set(&c, "tasks.group_by", "status").unwrap();
        assert_eq!(dto(&c).unwrap().tasks_group_by, "none");
    }
}
