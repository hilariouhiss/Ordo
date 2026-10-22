use rusqlite::Connection;
use uuid::Uuid;

const V1: &str = r#"
CREATE TABLE people (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  is_me INTEGER NOT NULL DEFAULT 0,
  color TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  due_date TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE project_members (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, person_id)
);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  owner_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  start_date TEXT,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','doing','done')),
  in_week INTEGER NOT NULL DEFAULT 1,
  carry_count INTEGER NOT NULL DEFAULT 0,
  suspended_until TEXT,
  note TEXT,
  archived_at TEXT,
  canceled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE task_tags (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
);

CREATE TABLE steps (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  due_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE delays (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('reschedule','overdue_note')),
  old_due TEXT,
  new_due TEXT,
  reason TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('due_tomorrow','overdue','suspend_start')),
  due_key TEXT NOT NULL,
  scheduled_for TEXT NOT NULL,
  fired_at TEXT,
  seen_at TEXT,
  UNIQUE (task_id, kind, due_key)
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX idx_tasks_week ON tasks(in_week, archived_at, canceled_at);
CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_due ON tasks(due_date);
CREATE INDEX idx_steps_task ON steps(task_id, sort_order);
CREATE INDEX idx_notifications_sched ON notifications(scheduled_for, fired_at);
"#;

/// The schema version this build writes. Bump it with every new step below.
pub const LATEST: i64 = 8;

pub fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version < 1 {
        // One transaction, so a crash cannot leave half the schema behind.
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(V1)?;
        seed(&tx)?;
        tx.pragma_update(None, "user_version", 1)?;
        tx.commit()?;
    }

    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    // Kept at 2 on purpose: bumping LATEST must not re-run this step.
    if version < 2 {
        // The guard finishes a step cut short by a crash instead of dying on duplicate column.
        let tx = conn.unchecked_transaction()?;
        if !has_task_column(&tx, "done_at")? {
            tx.execute_batch("ALTER TABLE tasks ADD COLUMN done_at TEXT;")?;
        }
        tx.pragma_update(None, "user_version", 2)?;
        tx.commit()?;
    }

    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version < 3 {
        // A crash between statements could leave the columns without the version bump,
        // so this step only adds what is missing and commits as one transaction.
        let tx = conn.unchecked_transaction()?;
        if !has_task_column(&tx, "sort_order")? {
            tx.execute_batch("ALTER TABLE tasks ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0")?;
        }
        if !has_task_column(&tx, "effort_days")? {
            tx.execute_batch("ALTER TABLE tasks ADD COLUMN effort_days REAL NOT NULL DEFAULT 1")?;
        }
        tx.execute_batch("UPDATE tasks SET sort_order = rowid")?;
        tx.pragma_update(None, "user_version", 3)?;
        tx.commit()?;
    }

    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version < 4 {
        // Categories are soft-deleted, so their tasks used to keep the dead id and drop out
        // of the project page. Data only: no schema change, and updated_at stays put.
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "UPDATE tasks SET category_id = NULL
             WHERE category_id IS NOT NULL
               AND category_id NOT IN (SELECT id FROM categories WHERE deleted_at IS NULL)",
            [],
        )?;
        tx.pragma_update(None, "user_version", 4)?;
        tx.commit()?;
    }

    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version < 5 {
        // "非项目" was only ever a seeded bucket for tasks outside projects. It is
        // gone now; detach first so the tasks stay, then soft-delete the category.
        let tx = conn.unchecked_transaction()?;
        let stamp = now();
        tx.execute(
            "UPDATE tasks SET category_id = NULL, updated_at = ?1
             WHERE category_id IN (
                 SELECT id FROM categories WHERE name = '非项目' AND deleted_at IS NULL
             )",
            [stamp.as_str()],
        )?;
        tx.execute(
            "UPDATE categories SET deleted_at = ?1, updated_at = ?1
             WHERE name = '非项目' AND deleted_at IS NULL",
            [stamp.as_str()],
        )?;
        tx.pragma_update(None, "user_version", 5)?;
        tx.commit()?;
    }

    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version < 6 {
        // A crash between the ALTER and the version bump leaves the column without
        // the bump; the guard finishes the step instead of dying on duplicate column.
        let tx = conn.unchecked_transaction()?;
        if !has_task_column(&tx, "priority")? {
            tx.execute_batch(
                "ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal'
                 CHECK (priority IN ('high','normal','low'))",
            )?;
        }
        tx.pragma_update(None, "user_version", 6)?;
        tx.commit()?;
    }

    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version < 7 {
        // A suspension can now have neither a date nor a reason, so the marker cannot
        // live in suspended_until. Old rows with a date are still suspended.
        let tx = conn.unchecked_transaction()?;
        if !has_task_column(&tx, "suspended")? {
            tx.execute_batch("ALTER TABLE tasks ADD COLUMN suspended INTEGER NOT NULL DEFAULT 0")?;
        }
        if !has_task_column(&tx, "suspend_reason")? {
            tx.execute_batch("ALTER TABLE tasks ADD COLUMN suspend_reason TEXT")?;
        }
        tx.execute_batch("UPDATE tasks SET suspended = 1 WHERE suspended_until IS NOT NULL")?;
        tx.pragma_update(None, "user_version", 7)?;
        tx.commit()?;
    }

    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version < 8 {
        let tx = conn.unchecked_transaction()?;
        if !has_task_column(&tx, "suspended_at")? {
            tx.execute_batch("ALTER TABLE tasks ADD COLUMN suspended_at TEXT")?;
        }
        // Best available approximation for rows suspended before this column existed:
        // a suspended row's last write is usually the suspension itself.
        tx.execute_batch(
            "UPDATE tasks SET suspended_at = date(updated_at, 'localtime')
             WHERE suspended = 1 AND suspended_at IS NULL",
        )?;
        tx.pragma_update(None, "user_version", 8)?;
        tx.commit()?;
    }
    Ok(())
}

fn has_task_column(conn: &Connection, column: &str) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('tasks') WHERE name = ?1",
        [column],
        |r| r.get::<_, i64>(0),
    )
    .map(|count| count > 0)
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn seed(conn: &Connection) -> rusqlite::Result<()> {
    let ts = now();

    conn.execute(
        "INSERT INTO people (id, name, is_me, color, created_at, updated_at) VALUES (?1, '我', 1, NULL, ?2, ?2)",
        rusqlite::params![Uuid::new_v4().to_string(), ts],
    )?;

    let categories = ["软件", "硬件", "测试", "结构", "生产", "资料", "杂事"];
    for (i, name) in categories.iter().enumerate() {
        conn.execute(
            "INSERT INTO categories (id, name, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
            rusqlite::params![Uuid::new_v4().to_string(), name, i as i64, ts],
        )?;
    }

    for (key, value) in [
        ("ai.enabled", "false"),
        ("ai.base_url", "https://api.deepseek.com"),
        ("ai.model", "deepseek-flash"),
        ("shortcut", "Ctrl+Alt+O"),
        ("autostart", "true"),
        ("backup_keep_days", "30"),
        ("last_pass_week", ""),
    ] {
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)",
            rusqlite::params![key, value],
        )?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    #[test]
    fn migrates_to_v3_and_backfills_order() {
        let c = rusqlite::Connection::open_in_memory().unwrap();
        c.execute_batch(V1).unwrap();
        seed(&c).unwrap();
        for (id, title) in [("a", "甲"), ("b", "乙")] {
            c.execute(
                "INSERT INTO tasks (id, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
                rusqlite::params![id, title, "2026-10-20T08:00:00Z"],
            )
            .unwrap();
        }
        c.pragma_update(None, "user_version", 1).unwrap();

        migrate(&c).unwrap();

        let version: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(version, LATEST);
        let mut stmt = c
            .prepare("SELECT id, sort_order, effort_days FROM tasks ORDER BY sort_order")
            .unwrap();
        let rows: Vec<(String, i64, f64)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        assert_eq!(rows, vec![("a".to_string(), 1, 1.0), ("b".to_string(), 2, 1.0)]);
    }

    fn v2_database() -> rusqlite::Connection {
        let c = rusqlite::Connection::open_in_memory().unwrap();
        c.execute_batch(V1).unwrap();
        seed(&c).unwrap();
        c.execute_batch("ALTER TABLE tasks ADD COLUMN done_at TEXT;")
            .unwrap();
        for (id, title) in [("a", "甲"), ("b", "乙")] {
            c.execute(
                "INSERT INTO tasks (id, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
                rusqlite::params![id, title, "2026-10-20T08:00:00Z"],
            )
            .unwrap();
        }
        c.pragma_update(None, "user_version", 2).unwrap();
        c
    }

    fn v3_database() -> rusqlite::Connection {
        let c = v2_database();
        c.execute_batch(
            "ALTER TABLE tasks ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
             ALTER TABLE tasks ADD COLUMN effort_days REAL NOT NULL DEFAULT 1;",
        )
        .unwrap();
        c.pragma_update(None, "user_version", 3).unwrap();
        c
    }

    #[test]
    fn repairs_tasks_left_on_a_deleted_category() {
        let c = v3_database();
        let live: String = c
            .query_row("SELECT id FROM categories WHERE name = '软件'", [], |r| {
                r.get(0)
            })
            .unwrap();
        c.execute(
            "INSERT INTO categories (id, name, sort_order, created_at, updated_at, deleted_at)
             VALUES ('c-deleted', '旧分类', 99, ?1, ?1, ?1)",
            rusqlite::params!["2026-10-20T08:00:00Z"],
        )
        .unwrap();
        c.execute(
            "UPDATE tasks SET category_id = ?1 WHERE id = 'a'",
            rusqlite::params![live],
        )
        .unwrap();
        c.execute(
            "UPDATE tasks SET category_id = 'c-deleted' WHERE id = 'b'",
            [],
        )
        .unwrap();

        migrate(&c).unwrap();

        let kept: Option<String> = c
            .query_row("SELECT category_id FROM tasks WHERE id = 'a'", [], |r| {
                r.get(0)
            })
            .unwrap();
        let repaired: Option<String> = c
            .query_row("SELECT category_id FROM tasks WHERE id = 'b'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(kept.as_deref(), Some(live.as_str()));
        assert!(repaired.is_none());
        let version: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(version, LATEST);
    }

    #[test]
    fn upgrades_a_v2_database_and_keeps_done_at() {
        let c = v2_database();

        migrate(&c).unwrap();

        let version: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(version, LATEST);
        let mut stmt = c
            .prepare("SELECT id, sort_order, effort_days, done_at FROM tasks ORDER BY sort_order")
            .unwrap();
        let rows: Vec<(String, i64, f64, Option<String>)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!((rows[0].1, rows[0].2), (1, 1.0));
        assert_eq!((rows[1].1, rows[1].2), (2, 1.0));
        assert!(rows[0].3.is_none());
    }

    #[test]
    fn retries_a_half_applied_v3_step() {
        // A crash between statements leaves the columns without the version bump;
        // the next start must finish the step instead of dying on duplicate column.
        let c = v2_database();
        c.execute_batch(
            "ALTER TABLE tasks ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
             ALTER TABLE tasks ADD COLUMN effort_days REAL NOT NULL DEFAULT 1;",
        )
        .unwrap();

        migrate(&c).unwrap();

        let version: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(version, LATEST);
        let order: i64 = c
            .query_row("SELECT sort_order FROM tasks WHERE id = 'a'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(order, 1);
    }

    #[test]
    fn retries_a_half_applied_v2_step() {
        // A crash between the ALTER and the version bump leaves the column without the bump;
        // the next start must finish the step instead of dying on duplicate column.
        let c = rusqlite::Connection::open_in_memory().unwrap();
        c.execute_batch(V1).unwrap();
        seed(&c).unwrap();
        c.execute_batch("ALTER TABLE tasks ADD COLUMN done_at TEXT;")
            .unwrap();
        c.pragma_update(None, "user_version", 1).unwrap();

        migrate(&c).unwrap();

        let version: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(version, LATEST);
    }


    #[test]
    fn removes_the_non_project_category_and_detaches_tasks() {
        let c = v3_database();
        c.execute(
            "INSERT INTO categories (id, name, sort_order, created_at, updated_at)
             VALUES ('c-np', '非项目', 7, '2026-10-20T08:00:00Z', '2026-10-20T08:00:00Z')",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO tasks (id, title, category_id, created_at, updated_at)
             VALUES ('t-np', '随手记', 'c-np', '2026-10-20T08:00:00Z', '2026-10-20T08:00:00Z')",
            [],
        )
        .unwrap();
        c.execute(
            "UPDATE tasks SET category_id = (SELECT id FROM categories WHERE name = '软件')
             WHERE id = 'a'",
            [],
        )
        .unwrap();
        c.pragma_update(None, "user_version", 4).unwrap();

        migrate(&c).unwrap();

        let version: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(version, LATEST);
        let deleted: Option<String> = c
            .query_row("SELECT deleted_at FROM categories WHERE id = 'c-np'", [], |r| r.get(0))
            .unwrap();
        assert!(deleted.is_some());
        let detached: Option<String> = c
            .query_row("SELECT category_id FROM tasks WHERE id = 't-np'", [], |r| r.get(0))
            .unwrap();
        assert!(detached.is_none());
        let kept: Option<String> = c
            .query_row("SELECT category_id FROM tasks WHERE id = 'a'", [], |r| r.get(0))
            .unwrap();
        assert!(kept.is_some());

        migrate(&c).unwrap();
        let live: i64 = c
            .query_row(
                "SELECT COUNT(*) FROM categories WHERE name = '非项目' AND deleted_at IS NULL",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(live, 0);
    }

    #[test]
    fn migrates_schema_v1() {
        let c = db::open_in_memory().unwrap();
        let n: i64 = c
            .query_row(
                "select count(*) from sqlite_master where type='table' and name in \
                 ('people','projects','project_members','categories','tags','task_tags','tasks',\
                  'steps','delays','notifications','settings')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 11);
        let me: i64 = c
            .query_row("select count(*) from people where is_me=1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(me, 1);
        let cats: i64 = c
            .query_row("select count(*) from categories", [], |r| r.get(0))
            .unwrap();
        assert_eq!(cats, 7);
    }

    #[test]
    fn adds_the_suspension_marker_and_backfills_dated_rows() {
        let c = v3_database();
        c.execute(
            "UPDATE tasks SET suspended_until = '2026-11-02' WHERE id = 'a'",
            [],
        )
        .unwrap();

        migrate(&c).unwrap();

        let version: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(version, LATEST);
        let (suspended, reason): (i64, Option<String>) = c
            .query_row(
                "SELECT suspended, suspend_reason FROM tasks WHERE id = 'a'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(suspended, 1);
        assert!(reason.is_none());
        let other: i64 = c
            .query_row("SELECT suspended FROM tasks WHERE id = 'b'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(other, 0);
    }

    #[test]
    fn adds_priority_with_a_normal_default() {
        let c = v3_database();

        migrate(&c).unwrap();

        let version: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(version, LATEST);
        let priorities: Vec<String> = c
            .prepare("SELECT priority FROM tasks ORDER BY sort_order")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        assert_eq!(priorities, vec!["normal".to_string(), "normal".to_string()]);
    }

    #[test]
    fn retries_a_half_applied_v6_step() {
        let c = v3_database();
        c.execute_batch(
            "ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal'
             CHECK (priority IN ('high','normal','low'));",
        )
        .unwrap();
        c.execute("UPDATE tasks SET priority = 'high' WHERE id = 'a'", [])
            .unwrap();
        c.pragma_update(None, "user_version", 5).unwrap();

        migrate(&c).unwrap();

        let version: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(version, LATEST);
        let priority: String = c
            .query_row("SELECT priority FROM tasks WHERE id = 'a'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(priority, "high");
    }

    #[test]
    fn adds_suspended_at_and_backfills_suspended_rows() {
        let c = v3_database();
        c.execute(
            "UPDATE tasks SET suspended_until = '2026-11-02' WHERE id = 'a'",
            [],
        )
        .unwrap();

        migrate(&c).unwrap();

        let (suspended, at): (i64, Option<String>) = c
            .query_row(
                "SELECT suspended, suspended_at FROM tasks WHERE id = 'a'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(suspended, 1);
        let expected: String = c
            .query_row(
                "SELECT date(updated_at, 'localtime') FROM tasks WHERE id = 'a'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(at.as_deref(), Some(expected.as_str()));
        let other: Option<String> = c
            .query_row("SELECT suspended_at FROM tasks WHERE id = 'b'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert!(other.is_none());
    }
}