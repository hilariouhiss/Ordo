use rusqlite::types::ValueRef;
use rusqlite::Connection;
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};

const TABLES: [&str; 11] = [
    "people",
    "projects",
    "project_members",
    "categories",
    "tags",
    "tasks",
    "task_tags",
    "steps",
    "delays",
    "notifications",
    "settings",
];

pub fn to_json(conn: &Connection, path: &Path) -> Result<(), String> {
    let mut out = Map::new();
    for table in TABLES {
        out.insert(table.to_string(), Value::Array(dump(conn, table)?));
    }
    let text = serde_json::to_string_pretty(&Value::Object(out)).map_err(|e| e.to_string())?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, text).map_err(|e| e.to_string())
}

fn dump(conn: &Connection, table: &str) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare(&format!("SELECT * FROM {}", table))
        .map_err(|e| e.to_string())?;
    let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let rows = stmt
        .query_map([], |row| {
            let mut map = Map::new();
            for (i, name) in names.iter().enumerate() {
                let value = match row.get_ref(i)? {
                    ValueRef::Null => Value::Null,
                    ValueRef::Integer(n) => Value::from(n),
                    ValueRef::Real(f) => Value::from(f),
                    ValueRef::Text(t) => Value::from(String::from_utf8_lossy(t).to_string()),
                    ValueRef::Blob(_) => Value::Null,
                };
                map.insert(name.clone(), value);
            }
            Ok(Value::Object(map))
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())
}

pub fn prune(dir: &Path, keep_days: i64, today: &str) -> std::io::Result<()> {
    let today = match chrono::NaiveDate::parse_from_str(today, "%Y-%m-%d") {
        Ok(d) => d,
        Err(_) => return Ok(()),
    };
    for entry in std::fs::read_dir(dir)? {
        let path = entry?.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if !name.starts_with("ordo-") || !name.ends_with(".db") || name.len() < 15 {
            continue;
        }
        let Ok(date) = chrono::NaiveDate::parse_from_str(&name[5..15], "%Y-%m-%d") else {
            continue;
        };
        if (today - date).num_days() > keep_days {
            std::fs::remove_file(path)?;
        }
    }
    Ok(())
}

pub fn backup_today(conn: &Connection, dir: &Path) -> Result<Option<PathBuf>, String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let name = format!("ordo-{}.db", chrono::Local::now().format("%Y-%m-%d"));
    let path = dir.join(name);
    if path.exists() {
        return Ok(None);
    }
    conn.execute("VACUUM INTO ?1", [path.to_string_lossy().to_string()])
        .map_err(|e| e.to_string())?;
    Ok(Some(path))
}

/// Backs up once per day: a no-op when today's copy already exists, and old copies
/// are pruned only after a new one was actually written.
pub fn backup_daily(conn: &Connection, dir: &Path) -> Result<Option<PathBuf>, String> {
    let made = backup_today(conn, dir)?;
    if made.is_some() {
        let keep_days = crate::repo::settings::get(conn, "backup_keep_days")
            .ok()
            .flatten()
            .and_then(|v| v.parse().ok())
            .unwrap_or(30);
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        let _ = prune(dir, keep_days, &today);
    }
    Ok(made)
}

#[cfg(test)]
mod tests {
    use crate::db;
    use crate::services::{export, week};

    const NOW: &str = "2026-10-20T08:00:00Z";

    #[test]
    fn export_writes_all_tables() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();

        let dir = std::env::temp_dir().join(format!("ordo-export-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("export.json");
        export::to_json(&c, &path).unwrap();

        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.contains("\"tasks\""));
        assert!(text.contains("\"settings\""));
        assert!(text.contains("交底"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn old_backups_are_pruned() {
        let dir = std::env::temp_dir().join(format!("ordo-prune-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("ordo-2026-01-01.db"), b"old").unwrap();
        std::fs::write(dir.join("ordo-2026-09-01.db"), b"old").unwrap();
        std::fs::write(dir.join("ordo-2026-10-19.db"), b"keep").unwrap();
        std::fs::write(dir.join("notes.txt"), b"keep").unwrap();

        export::prune(&dir, 30, "2026-10-20").unwrap();
        assert!(!dir.join("ordo-2026-01-01.db").exists());
        assert!(!dir.join("ordo-2026-09-01.db").exists());
        assert!(dir.join("ordo-2026-10-19.db").exists());
        assert!(dir.join("notes.txt").exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn daily_backup_writes_once_a_day_and_prunes_old_copies() {
        let c = db::open_in_memory().unwrap();
        let dir = std::env::temp_dir().join(format!("ordo-daily-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("ordo-2000-01-01.db"), b"old").unwrap();

        let first = export::backup_daily(&c, &dir).unwrap();
        assert!(first.is_some());
        assert!(!dir.join("ordo-2000-01-01.db").exists());

        let second = export::backup_daily(&c, &dir).unwrap();
        assert!(second.is_none());
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn daily_backup_leaves_old_copies_alone_when_todays_backup_exists() {
        let c = db::open_in_memory().unwrap();
        let dir = std::env::temp_dir().join(format!("ordo-daily-skip-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        std::fs::write(dir.join(format!("ordo-{today}.db")), b"today").unwrap();
        std::fs::write(dir.join("ordo-2000-01-01.db"), b"old").unwrap();

        let made = export::backup_daily(&c, &dir).unwrap();

        assert!(made.is_none());
        assert!(dir.join("ordo-2000-01-01.db").exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn backup_is_idempotent_per_day() {
        let c = db::open_in_memory().unwrap();
        let dir = std::env::temp_dir().join(format!("ordo-backup-{}", uuid::Uuid::new_v4()));
        let first = export::backup_today(&c, &dir).unwrap();
        assert!(first.is_some());
        assert!(first.unwrap().exists());
        let second = export::backup_today(&c, &dir).unwrap();
        assert!(second.is_none());
        std::fs::remove_dir_all(&dir).ok();
    }
}