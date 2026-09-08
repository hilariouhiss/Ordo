use std::path::Path;
use std::sync::Mutex;

use rusqlite::Connection;

use crate::error::AppError;

mod embedded {
    use refinery::embed_migrations;
    embed_migrations!("migrations");
}

/// Shared handle to the SQLite connection, stored as Tauri managed state.
///
/// `Connection` is `Send` but not `Sync`, so it is wrapped in a `Mutex` to make
/// it safe to share across command handler threads.
pub type Db = Mutex<Connection>;

/// Opens the SQLite database at `path`, applies pending migrations, and returns
/// a shared `Db` handle suitable for `app.manage(...)`.
pub fn init(path: &Path) -> Result<Db, AppError> {
    let mut conn = Connection::open(path)?;
    embedded::migrations::runner().run(&mut conn)?;
    Ok(Mutex::new(conn))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn migrated_connection() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        embedded::migrations::runner().run(&mut conn).unwrap();
        conn
    }

    #[test]
    fn migrations_run_on_in_memory_db() {
        migrated_connection();
    }

    #[test]
    fn schema_contains_all_tables() {
        let conn = migrated_connection();
        let mut stmt = conn
            .prepare(
                "SELECT name FROM sqlite_master WHERE type IN ('table', 'index') ORDER BY name",
            )
            .unwrap();
        let names: Vec<String> = stmt
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();

        for expected in [
            "projects",
            "board_columns",
            "tasks",
            "subtasks",
            "tags",
            "task_tags",
            "comments",
            "time_entries",
            "settings",
            "task_search",
            "comment_search",
        ] {
            assert!(names.iter().any(|name| name == expected), "missing {expected}");
        }
    }

    #[test]
    fn foreign_keys_are_enforced() {
        let conn = migrated_connection();
        let result = conn.execute(
            "INSERT INTO tasks (id, title, project_id, priority, sort_order, created_at, updated_at)
             VALUES ('task-1', 'No project', 'missing-project', 'none', 'a', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        );
        assert!(result.is_err(), "insert with missing project_id should fail");
    }

    #[test]
    fn fts_triggers_keep_task_search_in_sync() {
        let conn = migrated_connection();

        let insert_task = |id: &str, title: &str, note: &str| {
            conn.execute(
                "INSERT INTO tasks (id, title, note, priority, sort_order, created_at, updated_at)
                 VALUES (?1, ?2, ?3, 'none', 'a', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
                rusqlite::params![id, title, note],
            )
            .unwrap();
        };
        let matches = |query: &str| -> i64 {
            conn.query_row(
                "SELECT count(*) FROM task_search WHERE task_search MATCH ?1",
                [query],
                |row| row.get(0),
            )
            .unwrap()
        };

        insert_task("task-1", "Quarterly report", "old note contents");
        assert_eq!(matches("report"), 1);
        assert_eq!(matches("quarterly"), 1);
        assert_eq!(matches("old"), 1);

        conn.execute("UPDATE tasks SET note = 'new budget review' WHERE id = 'task-1'", [])
            .unwrap();
        assert_eq!(matches("old"), 0);
        assert_eq!(matches("budget"), 1);

        conn.execute("DELETE FROM tasks WHERE id = 'task-1'", [])
            .unwrap();
        assert_eq!(matches("report"), 0);
    }

    #[test]
    fn fts_triggers_keep_comment_search_in_sync() {
        let conn = migrated_connection();
        conn.execute(
            "INSERT INTO tasks (id, title, priority, sort_order, created_at, updated_at)
             VALUES ('task-1', 'T', 'none', 'a', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO comments (id, task_id, body, created_at, updated_at)
             VALUES ('comment-1', 'task-1', 'important note', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        )
        .unwrap();

        let matches: i64 = conn
            .query_row(
                "SELECT count(*) FROM comment_search WHERE comment_search MATCH 'important'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(matches, 1);

        conn.execute(
            "UPDATE comments SET body = 'revised summary' WHERE id = 'comment-1'",
            [],
        )
        .unwrap();

        let after_update: i64 = conn
            .query_row(
                "SELECT count(*) FROM comment_search WHERE comment_search MATCH 'important'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(after_update, 0);

        conn.execute("DELETE FROM comments WHERE id = 'comment-1'", [])
            .unwrap();
        let after_delete: i64 = conn
            .query_row(
                "SELECT count(*) FROM comment_search WHERE comment_search MATCH 'summary'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(after_delete, 0);
    }
}
