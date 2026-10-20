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
