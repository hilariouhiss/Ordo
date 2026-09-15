use std::path::Path;
use std::sync::{Arc, Mutex};

use rusqlite::Connection;

use crate::error::AppError;

mod embedded {
    use refinery::embed_migrations;
    embed_migrations!("migrations");
}

/// Shared handle to the SQLite connection, stored as Tauri managed state.
///
/// `Connection` is `Send` but not `Sync`, so it is wrapped in a `Mutex` to
/// make it safe to share across threads; the `Arc` lets the reminder
/// scheduler thread hold the same connection as the command handlers.
pub type Db = Arc<Mutex<Connection>>;

/// Opens the SQLite database at `path`, applies pending migrations, and returns
/// a shared `Db` handle suitable for `app.manage(...)`.
pub fn init(path: &Path) -> Result<Db, AppError> {
    let mut conn = Connection::open(path)?;
    embedded::migrations::runner().run(&mut conn)?;
    Ok(Arc::new(Mutex::new(conn)))
}

/// In-memory SQLite connection with all migrations applied; shared by
/// repository unit tests.
#[cfg(test)]
pub(crate) fn test_conn() -> Connection {
    let mut conn = Connection::open_in_memory().expect("open in-memory db");
    embedded::migrations::runner()
        .run(&mut conn)
        .expect("run migrations");
    conn
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;

    fn migrated_connection() -> Connection {
        test_conn()
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
            "namespaces",
            "projects",
            "board_columns",
            "tasks",
            "tags",
            "task_tags",
            "comments",
            "time_entries",
            "settings",
            "task_search",
            "comment_search",
            "task_reminders",
            "task_dependencies",
            "idx_tasks_parent",
        ] {
            assert!(
                names.iter().any(|name| name == expected),
                "missing {expected}"
            );
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
        assert!(
            result.is_err(),
            "insert with missing project_id should fail"
        );
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

        conn.execute(
            "UPDATE tasks SET note = 'new budget review' WHERE id = 'task-1'",
            [],
        )
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

    #[test]
    fn v4_adds_attributes_and_dependency_tables() {
        let conn = migrated_connection();

        // A task written without the new column takes the documented default.
        conn.execute(
            "INSERT INTO tasks (id, title, priority, sort_order, created_at, updated_at) \
             VALUES ('t1', '写周报', 'none', 'a', ?1, ?1)",
            params!["2026-09-09T10:00:00Z"],
        )
        .unwrap();
        let complexity: Option<i64> = conn
            .query_row("SELECT complexity FROM tasks WHERE id = 't1'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(complexity, None, "complexity starts unestimated");

        // The CHECK is real: 6 is not a valid estimate.
        assert!(conn
            .execute("UPDATE tasks SET complexity = 6 WHERE id = 't1'", [])
            .is_err());

        // The edge table survived V7 as the only edge table, and its
        // self-reference CHECK still rejects a task depending on itself.
        // (Both endpoints exist, so the rejection can only come from the CHECK.)
        conn.execute(
            "INSERT INTO tasks (id, title, priority, sort_order, created_at, updated_at) \
             VALUES ('t2', '第二条', 'none', 'b', ?1, ?1)",
            params!["2026-09-09T10:00:00Z"],
        )
        .unwrap();
        assert!(
            conn.execute(
                "INSERT INTO task_dependencies (task_id, depends_on, created_at) \
                 VALUES ('t1', 't1', '2026-09-09T10:00:00Z')",
                [],
            )
            .is_err(),
            "an edge may not point at itself"
        );
    }

    #[test]
    fn v5_files_existing_projects_under_no_namespace() {
        // A user's database before this change ships is at V4 with rows in it;
        // the column must arrive as NULL for every one of them.
        let mut conn = Connection::open_in_memory().unwrap();
        embedded::migrations::runner()
            .set_target(refinery::Target::Version(4))
            .run(&mut conn)
            .unwrap();
        conn.execute(
            "INSERT INTO projects (id, name, status, sort_order, created_at, updated_at) \
             VALUES ('p1', '旧项目', 'active', 'a', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        )
        .unwrap();

        embedded::migrations::runner().run(&mut conn).unwrap();

        let namespace_id: Option<String> = conn
            .query_row(
                "SELECT namespace_id FROM projects WHERE id = 'p1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(namespace_id, None);
    }

    /// A V6 database with subtasks in it — the state a user's install is in
    /// right before this change ships.
    fn v6_connection_with_subtasks() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        embedded::migrations::runner()
            .set_target(refinery::Target::Version(6))
            .run(&mut conn)
            .unwrap();
        conn.execute_batch(
            "INSERT INTO projects (id, name, status, sort_order, created_at, updated_at) \
                 VALUES ('p1', '网站改版', 'active', 'a', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
             INSERT INTO tasks (id, project_id, title, priority, sort_order, created_at, updated_at) \
                 VALUES ('t1', 'p1', '写周报', 'none', 'a', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
             INSERT INTO subtasks (id, task_id, title, done, sort_order, created_at, updated_at) \
                 VALUES ('s1', 't1', '收集数据', 1, 'a', '2026-01-02T00:00:00Z', '2026-01-03T00:00:00Z'),
                        ('s2', 't1', '汇总',     0, 'b', '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z');
             INSERT INTO subtasks (id, task_id, title, done, sort_order, created_at, updated_at, deleted_at) \
                 VALUES ('s3', 't1', '删掉的', 0, 'c', '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z', '2026-01-04T00:00:00Z');
             INSERT INTO subtask_dependencies (subtask_id, depends_on, created_at) \
                 VALUES ('s2', 's1', '2026-01-02T00:00:00Z');
             INSERT INTO subtask_reminders (subtask_id, kind, sent_at) \
                 VALUES ('s1', 'due', '2026-01-03T00:00:00Z');",
        )
        .unwrap();
        conn
    }

    #[test]
    fn v7_moves_subtasks_into_the_task_tree() {
        let mut conn = v6_connection_with_subtasks();
        embedded::migrations::runner().run(&mut conn).unwrap();

        // The three subtask tables are gone, the column and its index are here.
        let names: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'index')")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        for gone in ["subtasks", "subtask_dependencies", "subtask_reminders"] {
            assert!(!names.iter().any(|name| name == gone), "{gone} survived V7");
        }
        assert!(names.iter().any(|name| name == "idx_tasks_parent"));

        // Row conservation: soft-deleted children travel too, ids untouched.
        let moved: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tasks WHERE parent_task_id IS NOT NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(moved, 3);
        let parent: Option<String> = conn
            .query_row(
                "SELECT parent_task_id FROM tasks WHERE id = 's1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(parent.as_deref(), Some("t1"));

        // A child follows its parent's project; a child never lands on a board.
        let (project, column): (Option<String>, Option<String>) = conn
            .query_row(
                "SELECT project_id, column_id FROM tasks WHERE id = 's1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(project.as_deref(), Some("p1"));
        assert_eq!(column, None);

        // done = 1 became a completion instant; done = 0 stayed open.
        let completed: Option<String> = conn
            .query_row(
                "SELECT completed_at FROM tasks WHERE id = 's1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(completed.as_deref(), Some("2026-01-03T00:00:00Z"));
        let open: Option<String> = conn
            .query_row(
                "SELECT completed_at FROM tasks WHERE id = 's2'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(open, None);

        // The edge was remapped rather than dropped, and the marker survived —
        // a re-fire would spam the user with reminders they already got.
        let edge: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM task_dependencies WHERE task_id = 's2' AND depends_on = 's1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(edge, 1);
        let marker: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM task_reminders WHERE task_id = 's1' AND kind = 'due'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(marker, 1);
    }

    #[test]
    fn v7_keeps_migrated_children_searchable() {
        // `task_search` is a contentless FTS5 table over `tasks`, fed by the
        // `tasks_ai` trigger. Migrating by INSERT (not by rebuilding `tasks`)
        // is what keeps that trigger — and this assertion — honest.
        let mut conn = v6_connection_with_subtasks();
        embedded::migrations::runner().run(&mut conn).unwrap();

        let hits: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM task_search WHERE task_search MATCH '收集数据'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(hits, 1, "a migrated child must be findable through search");
    }
}
