pub mod migrations;

use rusqlite::Connection;
use std::path::Path;

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    configure(&conn)?;
    migrations::migrate(&conn)?;
    Ok(conn)
}

/// Opens the database, restoring the newest dated backup if the file cannot be read.
/// The unreadable file is copied aside first, so nothing is ever destroyed.
pub fn open_with_recovery(path: &Path, backups: &Path) -> Result<Connection, String> {
    if let Some(version) = read_version(path) {
        if version > 0 && version != migrations::LATEST {
            backup_before_migration(path, backups, version);
        }
    }
    match open(path) {
        Ok(conn) => Ok(conn),
        Err(broken) => recover(path, backups).map_err(|e| format!("{broken}; {e}")),
    }
}

/// Copies the database aside when a schema upgrade is about to rewrite it.
pub fn backup_before_migration(path: &Path, backups: &Path, from_version: i64) {
    let dest = backups.join(format!("pre-migration-v{from_version}.db"));
    if !path.exists() || dest.exists() || std::fs::create_dir_all(backups).is_err() {
        return;
    }
    let _ = std::fs::copy(path, dest);
}

fn read_version(path: &Path) -> Option<i64> {
    if !path.exists() {
        return None;
    }
    let conn = Connection::open(path).ok()?;
    conn.query_row("PRAGMA user_version", [], |r| r.get(0)).ok()
}

fn recover(path: &Path, backups: &Path) -> Result<Connection, String> {
    if path.exists() {
        let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
        std::fs::copy(path, path.with_extension(format!("db.corrupt-{stamp}")))
            .map_err(|e| format!("corrupt_copy_failed: {e}"))?;
    }
    let latest = newest_backup(backups).ok_or("no_backup_to_restore")?;
    // A WAL left behind by the broken file would be replayed into the restored one.
    for suffix in ["-wal", "-shm"] {
        let _ = std::fs::remove_file(format!("{}{suffix}", path.display()));
    }
    std::fs::copy(&latest, path).map_err(|e| format!("restore_failed: {e}"))?;
    open(path).map_err(|e| format!("restored_backup_unreadable: {e}"))
}

fn newest_backup(backups: &Path) -> Option<std::path::PathBuf> {
    let mut names: Vec<String> = std::fs::read_dir(backups)
        .ok()?
        .filter_map(|entry| entry.ok()?.file_name().into_string().ok())
        .filter(|name| name.starts_with("ordo-") && name.ends_with(".db"))
        .collect();
    names.sort();
    names.pop().map(|name| backups.join(name))
}

pub fn open_in_memory() -> rusqlite::Result<Connection> {
    let conn = Connection::open_in_memory()?;
    configure(&conn)?;
    migrations::migrate(&conn)?;
    Ok(conn)
}

fn configure(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::week;

    const NOW: &str = "2026-10-20T08:00:00Z";

    fn tempdir() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("ordo-recovery-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn corrupt_copies(dir: &Path) -> usize {
        std::fs::read_dir(dir)
            .unwrap()
            .filter(|entry| {
                entry
                    .as_ref()
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .contains("corrupt")
            })
            .count()
    }

    #[test]
    fn recovers_from_latest_backup_after_corruption() {
        let dir = tempdir();
        let path = dir.join("ordo.db");
        {
            let c = open(&path).unwrap();
            week::capture(&c, "留住的", NOW, "t1").unwrap();
        }
        std::fs::create_dir_all(dir.join("backups")).unwrap();
        std::fs::copy(&path, dir.join("backups/ordo-2026-10-20.db")).unwrap();
        std::fs::write(&path, b"not a database").unwrap();

        let c = open_with_recovery(&path, &dir.join("backups")).unwrap();
        let n: i64 = c
            .query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
        assert_eq!(corrupt_copies(&dir), 1);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn backs_up_before_upgrading_an_older_database() {
        let dir = tempdir();
        let path = dir.join("ordo.db");
        {
            let c = open(&path).unwrap();
            c.execute("ALTER TABLE tasks DROP COLUMN done_at", []).unwrap();
            c.pragma_update(None, "user_version", 1).unwrap();
        }

        let backups = dir.join("backups");
        open_with_recovery(&path, &backups).unwrap();
        assert!(backups.join("pre-migration-v1.db").exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn without_backup_keeps_corrupt_file_and_errors() {
        let dir = tempdir();
        let path = dir.join("ordo.db");
        std::fs::write(&path, b"not a database").unwrap();

        assert!(open_with_recovery(&path, &dir.join("backups")).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"not a database");
        assert_eq!(corrupt_copies(&dir), 1);
        std::fs::remove_dir_all(&dir).ok();
    }
}
