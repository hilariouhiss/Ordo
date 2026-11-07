pub mod migrations;

use rusqlite::Connection;
use std::path::{Path, PathBuf};

/// What a recovery did, so the caller can tell the user about it.
pub struct Recovery {
    pub restored_from: PathBuf,
    /// The broken file kept beside the ledger; absent when there was no file to keep.
    pub broken_file_kept_at: Option<PathBuf>,
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
    // A ledger that is gone while dated copies sit beside it is a lost file, not a first
    // run: starting an empty one would let the daily backup prune the copies within a month.
    if !path.exists() && !backups_newest_first(backups).is_empty() {
        return match recover(path, backups) {
            Ok((conn, recovery)) => Ok((conn, Some(recovery))),
            Err(e) => {
                // Nothing usable was restored; leave no half-copied file behind.
                let _ = std::fs::remove_file(path);
                Err(format!("missing_db; {e}"))
            }
        };
    }
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
        // Migrations only go forward; an older build must not write into a newer schema.
        if version > migrations::LATEST {
            return Err(format!("db_newer_than_app: {version}"));
        }
        if version > 0 && version != migrations::LATEST {
            backup_before_migration(path, backups, version)?;
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

/// Copies the database aside when a schema upgrade is about to rewrite it. Migrations only
/// go forward, so a copy that cannot be written stops the upgrade instead of letting it run
/// unprotected.
pub fn backup_before_migration(
    path: &Path,
    backups: &Path,
    from_version: i64,
) -> Result<(), String> {
    let dest = backups.join(format!("pre-migration-v{from_version}.db"));
    if !path.exists() {
        return Ok(());
    }
    if opens(&dest) {
        return Ok(());
    }
    // A copy cut short keeps the name but is worthless; the rename below needs it gone.
    if dest.exists() {
        std::fs::remove_file(&dest).map_err(|e| format!("pre_migration_backup_failed: {e}"))?;
    }
    std::fs::create_dir_all(backups).map_err(|e| format!("pre_migration_backup_failed: {e}"))?;
    copy_to(path, &dest).map_err(|e| format!("pre_migration_backup_failed: {e}"))
}

/// Whether this path is a database SQLite can read; a copy cut off mid-write is not.
fn opens(path: &Path) -> bool {
    let sized = std::fs::metadata(path)
        .map(|metadata| metadata.is_file() && metadata.len() > 0)
        .unwrap_or(false);
    sized
        && Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .and_then(|conn| conn.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0)))
            .is_ok()
}

/// Copies through a temporary name, so a crash leaves no file wearing the final name.
fn copy_to(from: &Path, to: &Path) -> std::io::Result<()> {
    let temp = PathBuf::from(format!("{}.tmp", to.display()));
    let _ = std::fs::remove_file(&temp);
    if let Err(e) = std::fs::copy(from, &temp) {
        let _ = std::fs::remove_file(&temp);
        return Err(e);
    }
    // Windows refuses to rename onto an existing name; the copy replaces it.
    let _ = std::fs::remove_file(to);
    let renamed = std::fs::rename(&temp, to);
    if renamed.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    renamed
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
    // Read before restoring: the restore recreates the path, so afterwards it always exists.
    let had_file = path.exists();
    if had_file {
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
    let kept = had_file.then_some(kept_at);
    let mut last = String::new();
    for candidate in candidates {
        if read_version(&candidate).is_some_and(|version| version > migrations::LATEST) {
            last = "restored_backup_too_new".to_string();
            continue;
        }
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
                        broken_file_kept_at: kept,
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

/// Markers in the new directory saying the legacy copy happened, or is in progress.
const LEGACY_MARKER: &str = "migrated-from-com.ordo.app";
const LEGACY_COPY_STARTED: &str = "migrating-from-com.ordo.app";

/// Copies the ledger out of the pre-rename bundle identifier's directory once.
/// The old directory is left in place as a safety copy.
pub fn migrate_legacy_data(old: &Path, new: &Path) -> std::io::Result<bool> {
    let finished = new.join(LEGACY_MARKER);
    if finished.is_file() {
        return Ok(false);
    }
    let started = new.join(LEGACY_COPY_STARTED);
    // A zero-byte destination is a copy cut off before its first byte, not a finished
    // migration; without this, the next start silently opens an empty ledger.
    let target_is_filled = new
        .join("ordo.db")
        .metadata()
        .map(|metadata| metadata.is_file() && metadata.len() > 0)
        .unwrap_or(false);
    if started.is_file() {
        // A copy ran before but never recorded its finish. If the ledger landed, only the
        // marker write was lost; otherwise finish the copy that was cut short.
        if target_is_filled {
            let _ = std::fs::write(&finished, b"");
            let _ = std::fs::remove_file(&started);
            return Ok(false);
        }
        if !old.join("ordo.db").is_file() {
            let _ = std::fs::remove_file(&started);
            return Ok(false);
        }
    } else {
        if target_is_filled {
            // The new directory is already in use; remember that the copy is done so a lost
            // ledger goes through the backup restore instead of the old copy.
            let _ = std::fs::write(&finished, b"");
            return Ok(false);
        }
        if !old.join("ordo.db").is_file() {
            return Ok(false);
        }
        // Dated backups in the new directory mean the app already ran there. A missing
        // ledger is then a lost file for open_with_recovery to restore, not a first run.
        if !backups_newest_first(&new.join("backups")).is_empty() {
            let _ = std::fs::create_dir_all(new);
            let _ = std::fs::write(&finished, b"");
            return Ok(false);
        }
    }
    std::fs::create_dir_all(new)?;
    let _ = std::fs::write(&started, b"");
    let copied = copy_tree(old, new);
    if copied.is_err() {
        // A half-copied database must not look like a finished migration next time.
        for name in DB_FILES {
            let _ = std::fs::remove_file(new.join(name));
        }
    } else {
        let _ = std::fs::write(&finished, b"");
        let _ = std::fs::remove_file(&started);
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
    // Side files first and ordo.db last, each through a temp name. A crash then
    // leaves no ordo.db, so the next start copies again instead of opening a
    // ledger whose write-ahead log never arrived.
    for name in ["ordo.db-wal", "ordo.db-shm", "ordo.db"] {
        let from = from.join(name);
        if from.exists() {
            copy_to(&from, &to.join(name))?;
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
        let kept = recovery.broken_file_kept_at.expect("the broken file was kept");
        assert_eq!(std::fs::read(&kept).unwrap(), BROKEN);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn restores_a_backup_when_the_ledger_file_is_gone() {
        let dir = tempdir();
        let path = dir.join("ordo.db");
        seed(&path);
        let backups = dir.join("backups");
        std::fs::create_dir_all(&backups).unwrap();
        std::fs::copy(&path, backups.join("ordo-2026-10-20.db")).unwrap();
        std::fs::remove_file(&path).unwrap();

        // No ledger beside a dated copy is a lost file, not a first run: opening a fresh
        // database here would let the next daily backup prune the only copy away.
        let (c, recovery) = open_with_recovery(&path, &backups).unwrap();
        let n: i64 = c
            .query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
        let recovery = recovery.expect("a recovery was reported");
        assert!(recovery.restored_from.ends_with("ordo-2026-10-20.db"));
        assert!(recovery.broken_file_kept_at.is_none(), "nothing to keep");
        assert_eq!(corrupt_copies(&dir), 0, "no phantom corrupt copy");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_missing_ledger_without_usable_backups_reports_and_leaves_no_file() {
        let dir = tempdir();
        let path = dir.join("ordo.db");
        let backups = dir.join("backups");
        std::fs::create_dir_all(&backups).unwrap();
        std::fs::write(backups.join("ordo-2026-10-20.db"), BROKEN).unwrap();

        let err = open_with_recovery(&path, &backups).err().unwrap();
        assert!(err.starts_with("missing_db;"), "{err}");
        assert!(!path.exists(), "a failed restore must not leave a stray file");
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
            for column in ["actual_finish_at", "sort_order", "effort_minutes", "started_at"] {
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
    fn a_failed_pre_migration_copy_stops_the_upgrade() {
        let dir = tempdir();
        let path = dir.join("ordo.db");
        {
            let c = open(&path).unwrap();
            c.pragma_update(None, "user_version", 1).unwrap();
        }
        // A directory wearing the copy's name makes every write into it fail.
        let backups = dir.join("backups");
        std::fs::create_dir_all(backups.join("pre-migration-v1.db")).unwrap();

        let err = open_with_recovery(&path, &backups).err().unwrap();
        assert!(err.starts_with("pre_migration_backup_failed"), "{err}");
        // The schema must still be the old one: no upgrade ran without its safety copy.
        let version: i64 = Connection::open(&path)
            .unwrap()
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, 1);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn refuses_a_ledger_written_by_a_newer_build() {
        let dir = tempdir();
        let path = dir.join("ordo.db");
        {
            let c = open(&path).unwrap();
            c.pragma_update(None, "user_version", 99).unwrap();
        }
        let backups = dir.join("backups");

        let err = open_with_recovery(&path, &backups).err().unwrap();

        assert!(err.starts_with("db_newer_than_app: 99"), "{err}");
        // Nothing was copied or rewritten: the newer build still owns this file.
        assert!(!backups.join("pre-migration-v99.db").exists());
        let version: i64 = Connection::open(&path)
            .unwrap()
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, 99);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_truncated_pre_migration_copy_is_replaced() {
        let dir = tempdir();
        let path = dir.join("ordo.db");
        {
            let c = open(&path).unwrap();
            c.pragma_update(None, "user_version", 1).unwrap();
        }
        // A copy cut off mid-write keeps the name but says nothing about the old schema.
        let backups = dir.join("backups");
        std::fs::create_dir_all(&backups).unwrap();
        std::fs::write(backups.join("pre-migration-v1.db"), b"half").unwrap();

        open_with_recovery(&path, &backups).unwrap();

        let old = Connection::open(backups.join("pre-migration-v1.db")).unwrap();
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
    fn a_missing_ledger_with_newer_backups_is_not_refilled_from_the_legacy_copy() {
        let dir = tempdir();
        let old = dir.join("old");
        let new = dir.join("new");
        std::fs::create_dir_all(&old).unwrap();
        std::fs::create_dir_all(new.join("backups")).unwrap();
        std::fs::write(old.join("ordo.db"), b"old ledger").unwrap();
        std::fs::write(new.join("backups").join("ordo-2026-10-20.db"), b"backup").unwrap();

        // A dated backup in the new directory means the app already ran there. A missing
        // ledger is a lost file for open_with_recovery to restore, not a first migration.
        assert!(!migrate_legacy_data(&old, &new).unwrap());
        assert!(!new.join("ordo.db").exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn resumes_a_legacy_copy_that_was_cut_short() {
        let dir = tempdir();
        let old = dir.join("old");
        let new = dir.join("new");
        std::fs::create_dir_all(&old).unwrap();
        std::fs::create_dir_all(new.join("backups")).unwrap();
        std::fs::write(old.join("ordo.db"), b"ledger").unwrap();
        std::fs::write(new.join("backups").join("ordo-2026-10-20.db"), b"backup").unwrap();
        std::fs::write(new.join(LEGACY_COPY_STARTED), b"").unwrap();

        // A copy in progress is finished even though it already left backups beside it.
        assert!(migrate_legacy_data(&old, &new).unwrap());
        assert_eq!(std::fs::read(new.join("ordo.db")).unwrap(), b"ledger");
        assert!(new.join(LEGACY_MARKER).exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_finished_migration_is_not_repeated_after_the_ledger_is_removed() {
        let dir = tempdir();
        let old = dir.join("old");
        let new = dir.join("new");
        std::fs::create_dir_all(&old).unwrap();
        std::fs::write(old.join("ordo.db"), b"old ledger").unwrap();

        assert!(migrate_legacy_data(&old, &new).unwrap());
        std::fs::remove_file(new.join("ordo.db")).unwrap();

        // The copy already happened once; bringing the old ledger back would silently
        // replace the newest backup with stale data.
        assert!(!migrate_legacy_data(&old, &new).unwrap());
        assert!(!new.join("ordo.db").exists());
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
