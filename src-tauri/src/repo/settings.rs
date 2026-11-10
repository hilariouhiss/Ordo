use crate::dto::{SavedTaskViewDto, SettingsDto, TaskFilterDto};
use rusqlite::Connection;
use std::collections::HashMap;

/// A task's own deadline minus this is when the advance reminder fires; 0 means no
/// advance reminder at all, so the default has to be a real lead rather than "off".
pub const DEFAULT_REMINDER_LEAD_MINUTES: i64 = 60;

/// The settings keys written and read from more than one module. One spelling each, so
/// a reader and a writer cannot drift apart. Single-module keys stay at their use site.
pub mod keys {
    pub const LANGUAGE: &str = "language";
    pub const THEME: &str = "theme";
    pub const AUTOSTART: &str = "autostart";
    pub const BACKUP_KEEP_DAYS: &str = "backup_keep_days";
    pub const BACKUP_ERROR: &str = "backup_error";
    pub const TRAY_HINT_SEEN: &str = "tray_hint_seen";
    pub const LAST_PASS_WEEK: &str = "last_pass_week";
    pub const AI_ENABLED: &str = "ai.enabled";
    pub const AI_BASE_URL: &str = "ai.base_url";
    pub const AI_MODEL: &str = "ai.model";
    pub const REMINDER_LEAD_MINUTES: &str = "reminders.lead_minutes";
    pub const REMINDERS_DIGEST: &str = "reminders.digest";
    pub const DIGEST_DATE: &str = "reminders.digest_date";
    pub const DESK_ENABLED: &str = "desk.enabled";
    pub const DESK_CONTROLS: &str = "desk.controls";
    pub const DESK_PIN: &str = "desk.pin";
    pub const DESK_X: &str = "desk.x";
    pub const DESK_Y: &str = "desk.y";
    pub const TASKS_GROUP_BY: &str = "tasks.group_by";
    pub const SAVED_VIEWS: &str = "tasks.saved_views";
    pub const WEEK_SHOW_EMPTY_DAYS: &str = "week.show_empty_days";
    pub const WEEK_HIDE_DONE: &str = "week.hide_done";
    pub const WEEK_VIEW: &str = "week.view";
}

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
    normalize_language(get(conn, keys::LANGUAGE).ok().flatten().as_deref()).into()
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

pub fn valid_week_view(value: &str) -> bool {
    matches!(value, "list" | "gantt")
}

pub fn valid_task_group_by(value: &str) -> bool {
    matches!(
        value,
        "none" | "project" | "category" | "tag" | "owner" | "priority"
    )
}

/// The settings key holding the task page's named views as a JSON array.
pub const SAVED_VIEWS_KEY: &str = keys::SAVED_VIEWS;

fn valid_priority(value: &str) -> bool {
    matches!(value, "high" | "normal" | "low")
}

pub fn valid_task_filter(filter: &TaskFilterDto) -> bool {
    filter
        .priority
        .as_deref()
        .map(valid_priority)
        .unwrap_or(true)
}

pub fn valid_saved_view(view: &SavedTaskViewDto) -> bool {
    !view.id.trim().is_empty()
        && !view.name.trim().is_empty()
        && view.name.chars().count() <= 40
        && valid_task_group_by(&view.group_by)
        && valid_task_filter(&view.filter)
}

pub fn valid_saved_views(views: &[SavedTaskViewDto]) -> bool {
    views.len() <= 20 && views.iter().all(valid_saved_view)
}

/// A hand-edited or older value must not stop the bootstrap: bad entries are
/// dropped and the list is capped instead of failing the whole settings read.
pub fn parse_saved_views(text: Option<&str>) -> Vec<SavedTaskViewDto> {
    text.and_then(|text| serde_json::from_str::<Vec<SavedTaskViewDto>>(text).ok())
        .map(|views| {
            views
                .into_iter()
                .filter(valid_saved_view)
                .take(20)
                .collect()
        })
        .unwrap_or_default()
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

/// How long before a task's own deadline the advance reminder fires; 0 turns it off.
pub fn reminder_lead_minutes(conn: &Connection) -> i64 {
    get(conn, keys::REMINDER_LEAD_MINUTES)
        .ok()
        .flatten()
        .and_then(|value| value.parse().ok())
        .unwrap_or(DEFAULT_REMINDER_LEAD_MINUTES)
        .clamp(0, crate::limits::LIMITS.reminder_lead_minutes)
}

/// The daily 09:00 digest is on unless the user turned it off.
pub fn reminders_digest(conn: &Connection) -> bool {
    get(conn, keys::REMINDERS_DIGEST)
        .ok()
        .flatten()
        .map(|value| value != "false")
        .unwrap_or(true)
}

/// The main window starts as the week widget when this is on.
pub fn desk_enabled(conn: &Connection) -> bool {
    get(conn, keys::DESK_ENABLED)
        .ok()
        .flatten()
        .as_deref()
        == Some("true")
}

pub fn dto(conn: &Connection) -> rusqlite::Result<SettingsDto> {
    let map = get_all(conn)?;
    Ok(SettingsDto {
        language: normalize_language(map.get(keys::LANGUAGE).map(String::as_str)).into(),
        ai_enabled: flag(&map, keys::AI_ENABLED, false),
        ai_base_url: map
            .get(keys::AI_BASE_URL)
            .cloned()
            .unwrap_or_else(|| "https://api.deepseek.com".into()),
        ai_model: map
            .get(keys::AI_MODEL)
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
        autostart: flag(&map, keys::AUTOSTART, true),
        backup_keep_days: num(&map, keys::BACKUP_KEEP_DAYS, 30),
        backup_error: map
            .get(keys::BACKUP_ERROR)
            .cloned()
            .filter(|v| !v.is_empty()),
        last_pass_week: map.get(keys::LAST_PASS_WEEK).cloned().unwrap_or_default(),
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
        theme: map.get(keys::THEME).cloned().unwrap_or_else(|| "system".into()),
        desk_enabled: flag(&map, keys::DESK_ENABLED, false),
        desk_controls: flag(&map, keys::DESK_CONTROLS, true),
        desk_pin: map
            .get(keys::DESK_PIN)
            .filter(|value| valid_desk_pin(value))
            .cloned()
            .unwrap_or_else(|| "top".into()),
        desk_x: opt_num(&map, keys::DESK_X),
        desk_y: opt_num(&map, keys::DESK_Y),
        tasks_group_by: map
            .get(keys::TASKS_GROUP_BY)
            .filter(|value| valid_task_group_by(value))
            .cloned()
            .unwrap_or_else(|| "project".into()),
        week_show_empty_days: flag(&map, keys::WEEK_SHOW_EMPTY_DAYS, true),
        week_hide_done: flag(&map, keys::WEEK_HIDE_DONE, false),
        week_view: map
            .get(keys::WEEK_VIEW)
            .filter(|value| valid_week_view(value))
            .cloned()
            .unwrap_or_else(|| "list".into()),
        saved_task_views: parse_saved_views(map.get(SAVED_VIEWS_KEY).map(String::as_str)),
        reminders_lead_minutes: num(&map, keys::REMINDER_LEAD_MINUTES, DEFAULT_REMINDER_LEAD_MINUTES)
            .clamp(0, crate::limits::LIMITS.reminder_lead_minutes),
        reminders_digest: flag(&map, keys::REMINDERS_DIGEST, true),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finished_work_is_shown_on_the_week_until_the_flag_is_set() {
        let c = crate::db::open_in_memory().unwrap();
        assert!(!dto(&c).unwrap().week_hide_done);

        set(&c, "week.hide_done", "true").unwrap();
        assert!(dto(&c).unwrap().week_hide_done);
    }

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
    fn week_view_defaults_to_list_and_roundtrips() {
        let c = crate::db::open_in_memory().unwrap();
        assert_eq!(dto(&c).unwrap().week_view, "list");

        for value in ["list", "gantt"] {
            assert!(valid_week_view(value));
            set(&c, "week.view", value).unwrap();
            assert_eq!(dto(&c).unwrap().week_view, value);
        }

        set(&c, "week.view", "board").unwrap();
        assert_eq!(dto(&c).unwrap().week_view, "list");
    }

    #[test]
    fn the_reminder_lead_defaults_to_an_hour() {
        let c = crate::db::open_in_memory().unwrap();
        assert_eq!(dto(&c).unwrap().reminders_lead_minutes, 60);
        assert_eq!(reminder_lead_minutes(&c), 60);

        // A stored 0 is an explicit "no advance reminder", not the default.
        set(&c, "reminders.lead_minutes", "0").unwrap();
        assert_eq!(dto(&c).unwrap().reminders_lead_minutes, 0);
        assert_eq!(reminder_lead_minutes(&c), 0);
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
        assert_eq!(dto(&c).unwrap().tasks_group_by, "project");

        for value in ["none", "project", "category", "tag", "owner", "priority"] {
            assert!(valid_task_group_by(value));
            set(&c, "tasks.group_by", value).unwrap();
            assert_eq!(dto(&c).unwrap().tasks_group_by, value);
        }

        set(&c, "tasks.group_by", "status").unwrap();
        assert_eq!(dto(&c).unwrap().tasks_group_by, "project");
    }

    #[test]
    fn saved_views_roundtrip_and_drop_bad_entries() {
        let c = crate::db::open_in_memory().unwrap();
        assert!(dto(&c).unwrap().saved_task_views.is_empty());

        let good = SavedTaskViewDto {
            id: "v1".into(),
            name: "滨江".into(),
            group_by: "project".into(),
            filter: TaskFilterDto {
                query: "交底".into(),
                project_id: Some("p1".into()),
                ..Default::default()
            },
        };
        let mut blank_name = good.clone();
        blank_name.id = "v2".into();
        blank_name.name = "  ".into();
        let mut bad_group = good.clone();
        bad_group.id = "v3".into();
        bad_group.group_by = "status".into();

        let text = serde_json::to_string(&[good.clone(), blank_name, bad_group]).unwrap();
        set(&c, SAVED_VIEWS_KEY, &text).unwrap();

        let views = dto(&c).unwrap().saved_task_views;
        assert_eq!(views.len(), 1);
        assert_eq!(views[0].id, "v1");
        assert_eq!(views[0].filter.project_id.as_deref(), Some("p1"));
        assert_eq!(views[0].filter.query, "交底");
    }

    #[test]
    fn a_broken_saved_views_value_reads_as_empty() {
        let c = crate::db::open_in_memory().unwrap();
        set(&c, SAVED_VIEWS_KEY, "{not json").unwrap();
        assert!(dto(&c).unwrap().saved_task_views.is_empty());
    }

    #[test]
    fn saved_views_are_capped_at_twenty() {
        let c = crate::db::open_in_memory().unwrap();
        let base = SavedTaskViewDto {
            id: "v".into(),
            name: "v".into(),
            group_by: "none".into(),
            filter: TaskFilterDto::default(),
        };
        let many: Vec<_> = (0..21)
            .map(|i| SavedTaskViewDto {
                id: format!("v{i}"),
                name: format!("v{i}"),
                ..base.clone()
            })
            .collect();
        assert!(!valid_saved_views(&many));
        let twenty: Vec<_> = many.into_iter().take(20).collect();
        assert!(valid_saved_views(&twenty));
        let doubled: Vec<_> = twenty.iter().chain(twenty.iter()).cloned().collect();
        set(
            &c,
            SAVED_VIEWS_KEY,
            &serde_json::to_string(&doubled).unwrap(),
        )
        .unwrap();
        assert_eq!(dto(&c).unwrap().saved_task_views.len(), 20);
    }

    #[test]
    fn saved_views_reject_unknown_priorities_and_long_names() {
        let view = SavedTaskViewDto {
            id: "v".into(),
            name: "v".into(),
            group_by: "none".into(),
            filter: TaskFilterDto {
                priority: Some("urgent".into()),
                ..Default::default()
            },
        };
        assert!(!valid_saved_view(&view));
        let long = SavedTaskViewDto {
            name: "长".repeat(41),
            ..view
        };
        assert!(!valid_saved_view(&long));
    }
}
