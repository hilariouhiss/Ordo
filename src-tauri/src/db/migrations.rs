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
pub const LATEST: i64 = 2;

pub fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version < 1 {
        conn.execute_batch(V1)?;
        seed(conn)?;
        conn.pragma_update(None, "user_version", 1)?;
    }

    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version < LATEST {
        conn.execute_batch("ALTER TABLE tasks ADD COLUMN done_at TEXT;")?;
        conn.pragma_update(None, "user_version", 2)?;
    }
    Ok(())
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

    let categories = ["软件", "硬件", "测试", "结构", "生产", "资料", "杂事", "非项目"];
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
        ("week_start", "1"),
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
    use crate::db;

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
        assert_eq!(cats, 8);
    }
}