pub mod migrations;

use rusqlite::Connection;
use std::path::{Path, PathBuf};

/// What a recovery did, so the caller can tell the user about it.
pub struct Recovery {
    pub restored_from: PathBuf,
    pub broken_file_kept_at: PathBuf,
}

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    configure(&conn)?;
    migrations::migrate(&conn)?;
    Ok(conn)
}

/// Opens the database, restoring a dated backup only when the file itself is corrupt.
/// Other failures are reported untouched, so a bad migration or a full disk cannot
/// quietly roll a working database back to yesterday.
pub fn open_with_recovery(
    path: &Path,
    backups: &Path,
) -> Result<(Connection, Option<Recovery>), String> {
    // SQLite opens a zero-byte file as a fresh database, so a truncated ledger would be
    // silently re-created empty. Treat it like a broken file and restore a backup.
    if is_empty_file(path) {
        if backups_newest_first(backups).is_empty() {
            // Nothing was ever written and there is nothing to restore: start fresh.
            let _ = std::fs::remove_file(path);
        } else {
            return recover(path, backups)
                .map(|(conn, recovery)| (conn, Some(recovery)))
                .map_err(|e| format!("empty_db; {e}"));
        }
    }
    if let Some(version) = read_version(path) {
        if version > 0 && version != migrations::LATEST {
            backup_before_migration(path, backups, version);
        }
    }
    match open(path) {
        Ok(conn) => Ok((conn, None)),
        Err(broken) if is_corrupt(&broken) => recover(path, backups)
            .map(|(conn, recovery)| (conn, Some(recovery)))
            .map_err(|e| format!("{broken}; {e}")),
        Err(other) => Err(other.to_string()),
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

fn is_empty_file(path: &Path) -> bool {
    std::fs::metadata(path)
        .map(|metadata| metadata.is_file() && metadata.len() == 0)
        .unwrap_or(false)
}

fn is_corrupt(error: &rusqlite::Error) -> bool {
    matches!(
        error.sqlite_error_code(),
        Some(rusqlite::ErrorCode::NotADatabase | rusqlite::ErrorCode::DatabaseCorrupt)
    )
}

fn read_version(path: &Path) -> Option<i64> {
    if !path.exists() {
        return None;
    }
    let conn = Connection::open(path).ok()?;
    conn.query_row("PRAGMA user_version", [], |r| r.get(0)).ok()
}

fn recover(path: &Path, backups: &Path) -> Result<(Connection, Recovery), String> {
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let kept_at = path.with_extension(format!("db.corrupt-{stamp}"));
    if path.exists() {
        std::fs::copy(path, &kept_at).map_err(|e| format!("corrupt_copy_failed: {e}"))?;
    }
    // The broken file's write-ahead log can hold its newest committed rows, and
    // replaying it into the restored file would corrupt that one instead. Set it
    // aside next to the copy rather than deleting it.
    for suffix in ["-wal", "-shm"] {
        let from = PathBuf::from(format!("{}{suffix}", path.display()));
        if from.exists() {
            let _ = std::fs::rename(&from, format!("{}{suffix}", kept_at.display()));
        }
    }

    let candidates = backups_newest_first(backups);
    if candidates.is_empty() {
        return Err("no_backup_to_restore".into());
    }
    let mut last = String::new();
    for candidate in candidates {
        if let Err(e) = std::fs::copy(&candidate, path) {
            last = format!("restore_failed: {e}");
            continue;
        }
        // A backup cut off before its first byte opens as a fresh database, not an error;
        // treating it as usable would silently replace the ledger with nothing.
        if is_empty_file(path) {
            last = "restored_backup_empty".to_string();
            continue;
        }
        match open(path) {
            Ok(conn) => {
                return Ok((
                    conn,
                    Recovery {
                        restored_from: candidate,
                        broken_file_kept_at: kept_at,
                    },
                ));
            }
            Err(e) => last = format!("restored_backup_unreadable: {e}"),
        }
    }
    Err(last)
}

fn backups_newest_first(backups: &Path) -> Vec<PathBuf> {
    let Ok(dir) = std::fs::read_dir(backups) else {
        return Vec::new();
    };
    let mut names: Vec<String> = dir
        .filter_map(|entry| entry.ok()?.file_name().into_string().ok())
        .filter(|name| name.starts_with("ordo-") && name.ends_with(".db"))
        .collect();
    names.sort();
    names
        .into_iter()
        .rev()
        .map(|name| backups.join(name))
        .collect()
}

const DB_FILES: [&str; 3] = ["ordo.db", "ordo.db-wal", "ordo.db-shm"];

/// Copies the ledger out of the pre-rename bundle identifier's directory once.
/// The old directory is left in place as a safety copy.
pub fn migrate_legacy_data(old: &Path, new: &Path) -> std::io::Result<bool> {
    // A zero-byte destination is a copy cut off before its first byte, not a finished
    // migration; without this, the next start silently opens an empty ledger.
    let target_is_filled = new
        .join("ordo.db")
        .metadata()
        .map(|metadata| metadata.is_file() && metadata.len() > 0)
        .unwrap_or(false);
    if !old.join("ordo.db").is_file() || target_is_filled {
        return Ok(false);
    }
    std::fs::create_dir_all(new)?;
    let copied = copy_tree(old, new);
    if copied.is_err() {
        // A half-copied database must not look like a finished migration next time.
        for name in DB_FILES {
            let _ = std::fs::remove_file(new.join(name));
        }
    }
    copied.map(|()| true)
}

fn copy_tree(from: &Path, to: &Path) -> std::io::Result<()> {
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if DB_FILES.contains(&name.as_ref()) {
            continue;
        }
        copy_entry(&entry.path(), &to.join(name.as_ref()))?;
    }
    // The database trio goes last, so a half-copied directory has no ordo.db.
    for name in DB_FILES {
        let from = from.join(name);
        if from.exists() {
            std::fs::copy(&from, to.join(name))?;
        }
    }
    Ok(())
}

fn copy_entry(from: &Path, to: &Path) -> std::io::Result<()> {
    if from.is_dir() {
        std::fs::create_dir_all(to)?;
        for entry in std::fs::read_dir(from)? {
            let entry = entry?;
            copy_entry(&entry.path(), &to.join(entry.file_name()))?;
        }
        Ok(())
    } else {
        std::fs::copy(from, to).map(|_| ())
    }
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
    const BROKEN: &[u8] = b"not a database";

    fn tempdir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ordo-recovery-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn names(dir: &Path) -> Vec<String> {
        std::fs::read_dir(dir)
            .unwrap()
            .filter_map(|entry| entry.ok()?.file_name().into_string().ok())
            .collect()
    }

    fn corrupt_copies(dir: &Path) -> usize {
        names(dir).iter().filter(|n| n.contains("corrupt")).count()
    }

    fn seed(path: &Path) {
        let c = open(path).unwrap();
        week::capture(&c, "留住的", NOW, "t1").unwrap();
    }

    #[test]
    fn recovers_from_latest_backup_after_corruption() {
        let dir = tempdir();
        let path = dir.join("ordo.db");
        seed(&path);
        let backups = dir.join("backups");
        std::fs::create_dir_all(&backups).unwrap();
        std::fs::copy(&path, backups.join("ordo-2026-10-19.db")).unwrap();
        std::fs::copy(&path, backups.join("ordo-2026-10-20.db")).unwrap();
        std::fs::write(&path, BROKEN).unwrap();

        let (c, recovery) = open_with_recovery(&path, &backups).unwrap();
        let n: i64 = c
            .query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);

        let recovery = recovery.expect("a recovery was reported");
        assert!(recovery.restored_from.ends_with("ordo-2026-10-20.db"));
        assert_eq!(corrupt_copies(&dir), 1);
        // The copy must be the broken bytes, not the restored database.
        assert_eq!(std::fs::read(&recovery.broken_file_kept_at).unwrap(), BROKEN);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn falls_back_to_an_older_backup_when_the_newest_is_unreadable() {
        let dir = tempdir();
        let path = dir.join("ordo.db");
        seed(&path);
        let backups = dir.join("backups");
        std::fs::create_dir_all(&backups).unwrap();
        std::fs::copy(&path, backups.join("ordo-2026-10-19.db")).unwrap();
        std::fs::write(backups.join("ordo-2026-10-20.db"), BROKEN).unwrap();
        std::fs::write(&path, BROKEN).unwrap();

        let (c, recovery) = open_with_recovery(&path, &backups).unwrap();
        let n: i64 = c
            .query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
        assert!(
            recovery
                .unwrap()
                .restored_from
                .ends_with("ordo-2026-10-19.db")
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn skips_an_empty_backup_and_restores_an_older_one() {
        let dir = tempdir();
        let path = dir.join("ordo.db");
        seed(&path);
        let backups = dir.join("backups");
        std::fs::create_dir_all(&backups).unwrap();
        std::fs::copy(&path, backups.join("ordo-2026-10-19.db")).unwrap();
        std::fs::write(backups.join("ordo-2026-10-20.db"), b"").unwrap();
        std::fs::write(&path, BROKEN).unwrap();

        let (c, recovery) = open_with_recovery(&path, &backups).unwrap();
        let n: i64 = c
            .query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
        assert!(
            recovery
                .unwrap()
                .restored_from
                .ends_with("ordo-2026-10-19.db")
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn recovery_sets_the_broken_write_ahead_log_aside() {
        let dir = tempdir();
        let path = dir.join("ordo.db");
        std::fs::write(&path, BROKEN).unwrap();
        std::fs::write(format!("{}-wal", path.display()), b"unflushed rows").unwrap();

        // Straight to the recovery step: SQLite itself may drop a stale log on open.
        assert_eq!(
            recover(&path, &dir.join("backups")).err().unwrap(),
            "no_backup_to_restore"
        );
        let kept = names(&dir)
            .into_iter()
            .find(|name| name.contains("corrupt") && name.ends_with("-wal"))
            .unwrap_or_else(|| panic!("write-ahead log not kept: {:?}", names(&dir)));
        assert_eq!(std::fs::read(dir.join(kept)).unwrap(), b"unflushed rows");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_non_corruption_error_leaves_the_file_alone() {
        let dir = tempdir();
        let path = dir.join("ordo.db");
        // A directory where the database should be: the open fails, but nothing is corrupt.
        std::fs::create_dir_all(&path).unwrap();

        assert!(open_with_recovery(&path, &dir.join("backups")).is_err());
        assert!(path.is_dir());
        assert_eq!(corrupt_copies(&dir), 0);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn backs_up_before_upgrading_an_older_database() {
        let dir = tempdir();
        let path = dir.join("ordo.db");
        {
            let c = open(&path).unwrap();
            for column in ["done_at", "sort_order", "effort_minutes"] {
                c.execute(&format!("ALTER TABLE tasks DROP COLUMN {column}"), [])
                    .unwrap();
            }
            c.pragma_update(None, "user_version", 1).unwrap();
        }

        let backups = dir.join("backups");
        open_with_recovery(&path, &backups).unwrap();
        let copy = backups.join("pre-migration-v1.db");
        assert!(copy.exists());
        // The copy must predate the upgrade.
        let old = Connection::open(&copy).unwrap();
        let version: i64 = old
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, 1);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn without_backup_keeps_corrupt_file_and_errors() {
        let dir = tempdir();
        let path = dir.join("ordo.db");
        std::fs::write(&path, BROKEN).unwrap();

        assert!(open_with_recovery(&path, &dir.join("backups")).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), BROKEN);
        assert_eq!(corrupt_copies(&dir), 1);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn recovers_from_backup_when_the_database_file_is_empty() {
        let dir = tempdir();
        let path = dir.join("ordo.db");
        seed(&path);
        let backups = dir.join("backups");
        std::fs::create_dir_all(&backups).unwrap();
        std::fs::copy(&path, backups.join("ordo-2026-10-20.db")).unwrap();
        std::fs::write(&path, b"").unwrap();

        // SQLite opens a zero-byte file as a valid, empty database; recovery must not.
        let (c, recovery) = open_with_recovery(&path, &backups).unwrap();
        let n: i64 = c
            .query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
        assert!(recovery.is_some());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn starts_fresh_when_an_empty_database_has_no_backups() {
        let dir = tempdir();
        let path = dir.join("ordo.db");
        std::fs::write(&path, b"").unwrap();

        let (c, recovery) = open_with_recovery(&path, &dir.join("backups")).unwrap();
        assert!(recovery.is_none());
        week::capture(&c, "新账本", NOW, "t1").unwrap();
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn migrates_again_when_the_new_database_is_empty() {
        let dir = tempdir();
        let old = dir.join("old");
        let new = dir.join("new");
        std::fs::create_dir_all(&old).unwrap();
        std::fs::create_dir_all(&new).unwrap();
        std::fs::write(old.join("ordo.db"), b"ledger").unwrap();
        std::fs::write(new.join("ordo.db"), b"").unwrap();

        // A copy cut off before the first byte must not count as a finished migration.
        assert!(migrate_legacy_data(&old, &new).unwrap());
        assert_eq!(std::fs::read(new.join("ordo.db")).unwrap(), b"ledger");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn migrates_the_old_data_directory_once() {
        let dir = tempdir();
        let old = dir.join("old");
        let new = dir.join("new");
        std::fs::create_dir_all(old.join("backups")).unwrap();
        std::fs::create_dir_all(old.join("exports")).unwrap();
        std::fs::write(old.join("ordo.db"), b"ledger").unwrap();
        std::fs::write(old.join("ordo.db-wal"), b"wal").unwrap();
        std::fs::write(old.join("backups").join("ordo-2026-10-20.db"), b"backup").unwrap();
        std::fs::write(old.join("exports").join("ordo.json"), b"{}").unwrap();

        assert!(migrate_legacy_data(&old, &new).unwrap());
        assert_eq!(std::fs::read(new.join("ordo.db")).unwrap(), b"ledger");
        assert_eq!(std::fs::read(new.join("ordo.db-wal")).unwrap(), b"wal");
        assert_eq!(
            std::fs::read(new.join("backups").join("ordo-2026-10-20.db")).unwrap(),
            b"backup"
        );
        assert_eq!(
            std::fs::read(new.join("exports").join("ordo.json")).unwrap(),
            b"{}"
        );
        // The old directory is a safety copy, not something migration deletes.
        assert_eq!(std::fs::read(old.join("ordo.db")).unwrap(), b"ledger");

        // A database already in the new directory means migration already ran.
        std::fs::write(new.join("ordo.db"), b"newer").unwrap();
        assert!(!migrate_legacy_data(&old, &new).unwrap());
        assert_eq!(std::fs::read(new.join("ordo.db")).unwrap(), b"newer");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn leaves_an_existing_database_alone() {
        let dir = tempdir();
        let old = dir.join("old");
        let new = dir.join("new");
        std::fs::create_dir_all(&old).unwrap();
        std::fs::create_dir_all(&new).unwrap();
        std::fs::write(old.join("ordo.db"), b"old").unwrap();
        std::fs::write(new.join("ordo.db"), b"new").unwrap();

        assert!(!migrate_legacy_data(&old, &new).unwrap());
        assert_eq!(std::fs::read(new.join("ordo.db")).unwrap(), b"new");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn does_nothing_when_old_data_is_missing() {
        let dir = tempdir();
        let old = dir.join("old");
        let new = dir.join("new");
        std::fs::create_dir_all(&old).unwrap();

        assert!(!migrate_legacy_data(&old, &new).unwrap());
        assert!(!new.exists());
        std::fs::remove_dir_all(&dir).ok();
    }
}
