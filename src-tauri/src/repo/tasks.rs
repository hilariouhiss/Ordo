use crate::dto::{ArchiveTaskDto, CaptureFields, DelayDto, StepDto, TagDto, TaskDto};
use rusqlite::types::Value;
use rusqlite::{params, Connection};

/// The week, the pass and reminders only see live tasks outside archived projects.
pub(crate) const VISIBLE_TASK_FILTER: &str = concat!(
    "canceled_at IS NULL AND archived_at IS NULL AND deleted_at IS NULL ",
    "AND (project_id IS NULL OR EXISTS (SELECT 1 FROM projects p ",
    "WHERE p.id = tasks.project_id AND p.archived_at IS NULL))"
);

/// Archive lists keep a task inside its archived project; restoring the project comes first.
const LIVE_PROJECT: &str = concat!(
    "(project_id IS NULL OR NOT EXISTS (SELECT 1 FROM projects p ",
    "WHERE p.id = tasks.project_id AND p.archived_at IS NOT NULL))"
);

pub fn insert(
    conn: &Connection,
    id: &str,
    title: &str,
    fields: &CaptureFields,
    now: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO tasks (id, title, project_id, owner_id, priority, due_date, effort_days,
                            status, in_week, carry_count, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3,
                 COALESCE(?4, (SELECT id FROM people WHERE is_me = 1 LIMIT 1)),
                 COALESCE(?5, 'normal'), ?6, COALESCE(?7, 1),
                 'todo', 1, 0,
                 (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM tasks), ?8, ?8)",
        params![
            id,
            title,
            fields.project_id.as_deref(),
            fields.owner_id.as_deref(),
            fields.priority.as_deref(),
            fields.due_date.as_deref(),
            fields.effort_days,
            now
        ],
    )?;
    Ok(())
}

pub fn list_week_ids(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    let sql = format!(
        "SELECT id FROM tasks
         WHERE in_week = 1 AND suspended = 0 AND {VISIBLE_TASK_FILTER}
         ORDER BY sort_order, id"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], |r| r.get(0))?;
    rows.collect()
}

pub fn list_week(conn: &Connection) -> rusqlite::Result<Vec<TaskDto>> {
    dtos(conn, &list_week_ids(conn)?)
}

/// Loads the full row and its children for each id, keeping the given order.
pub fn dtos(conn: &Connection, ids: &[String]) -> rusqlite::Result<Vec<TaskDto>> {
    ids.iter().map(|id| dto(conn, id)).collect()
}

pub fn list_all_active(conn: &Connection) -> rusqlite::Result<Vec<TaskDto>> {
    let mut stmt = conn.prepare(
        "SELECT id FROM tasks
         WHERE deleted_at IS NULL AND archived_at IS NULL AND canceled_at IS NULL
           AND status <> 'done'
         ORDER BY CASE status WHEN 'doing' THEN 0 WHEN 'todo' THEN 1 ELSE 2 END,
                  due_date IS NULL, due_date, created_at",
    )?;
    let ids: Vec<String> = stmt
        .query_map([], |r| r.get(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    dtos(conn, &ids)
}

pub fn dto(conn: &Connection, id: &str) -> rusqlite::Result<TaskDto> {
    let mut task_stmt = conn.prepare_cached(
        "SELECT id, title, project_id, category_id, owner_id, start_date, due_date, status,
                in_week, carry_count, suspended_until, suspended, suspended_at, suspend_reason,
                note, archived_at, canceled_at,
                created_at, updated_at, sort_order, effort_days, priority, time_exclusive
         FROM tasks WHERE id = ?1",
    )?;
    let mut task = task_stmt.query_row([id], |r| {
        Ok(TaskDto {
            id: r.get(0)?,
            title: r.get(1)?,
            project_id: r.get(2)?,
            category_id: r.get(3)?,
            owner_id: r.get(4)?,
            start_date: r.get(5)?,
            due_date: r.get(6)?,
            status: r.get(7)?,
            in_week: r.get::<_, i64>(8)? == 1,
            carry_count: r.get(9)?,
            suspended_until: r.get(10)?,
            suspended: r.get::<_, i64>(11)? == 1,
            suspended_at: r.get(12)?,
            suspend_reason: r.get(13)?,
            note: r.get(14)?,
            archived_at: r.get(15)?,
            canceled_at: r.get(16)?,
            steps: vec![],
            tags: vec![],
            delays: vec![],
            created_at: r.get(17)?,
            updated_at: r.get(18)?,
            sort_order: r.get(19)?,
            effort_days: r.get(20)?,
            priority: r.get(21)?,
            exclusive: r.get::<_, i64>(22)? == 1,
        })
    })?;

    let mut steps = conn.prepare_cached(
        "SELECT id, task_id, title, sort_order, done FROM steps
         WHERE task_id = ?1 AND deleted_at IS NULL ORDER BY sort_order",
    )?;
    task.steps = steps
        .query_map([id], |r| {
            Ok(StepDto {
                id: r.get(0)?,
                task_id: r.get(1)?,
                title: r.get(2)?,
                sort_order: r.get(3)?,
                done: r.get::<_, i64>(4)? == 1,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut tags = conn.prepare_cached(
        "SELECT t.id, t.name FROM tags t JOIN task_tags tt ON tt.tag_id = t.id
         WHERE tt.task_id = ?1 AND t.deleted_at IS NULL ORDER BY t.name",
    )?;
    task.tags = tags
        .query_map([id], |r| {
            Ok(TagDto {
                id: r.get(0)?,
                name: r.get(1)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut delays = conn.prepare_cached(
        "SELECT id, task_id, kind, old_due, new_due, reason, created_at FROM delays
         WHERE task_id = ?1 ORDER BY created_at",
    )?;
    task.delays = delays
        .query_map([id], |r| {
            Ok(DelayDto {
                id: r.get(0)?,
                task_id: r.get(1)?,
                kind: r.get(2)?,
                old_due: r.get(3)?,
                new_due: r.get(4)?,
                reason: r.get(5)?,
                created_at: r.get(6)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(task)
}
pub fn stored_status(conn: &Connection, id: &str) -> rusqlite::Result<String> {
    conn.query_row("SELECT status FROM tasks WHERE id = ?1", [id], |r| r.get(0))
}

pub fn set_status(
    conn: &Connection,
    id: &str,
    status: &str,
    leave_week: bool,
    now: &str,
    start_date: Option<&str>,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE tasks SET status = ?1,
            in_week = CASE WHEN ?2 THEN 0 WHEN suspended THEN 0 ELSE 1 END,
            suspended = CASE WHEN ?2 THEN 0 ELSE suspended END,
            suspended_until = CASE WHEN ?2 THEN NULL ELSE suspended_until END,
            suspended_at = CASE WHEN ?2 THEN NULL ELSE suspended_at END,
            suspend_reason = CASE WHEN ?2 THEN NULL ELSE suspend_reason END,
            start_date = CASE WHEN ?1 = 'doing' THEN COALESCE(start_date, ?5) ELSE start_date END,
            done_at = CASE WHEN ?2 THEN ?3 ELSE NULL END,
            updated_at = ?3
         WHERE id = ?4",
        params![status, leave_week as i64, now, id, start_date],
    )?;
    Ok(())
}

/// Writes only the fields the patch names, so untouched columns keep their value.
pub fn apply_patch(
    conn: &Connection,
    id: &str,
    patch: &crate::dto::TaskPatch,
    now: &str,
) -> rusqlite::Result<()> {
    fn push(
        cols: &mut Vec<&'static str>,
        vals: &mut Vec<Value>,
        col: &'static str,
        value: &Option<Option<String>>,
    ) {
        if let Some(value) = value {
            cols.push(col);
            vals.push(match value {
                Some(text) => Value::Text(text.clone()),
                None => Value::Null,
            });
        }
    }

    let tx = conn.unchecked_transaction()?;
    let mut cols: Vec<&'static str> = Vec::new();
    let mut vals: Vec<Value> = Vec::new();
    if let Some(title) = &patch.title {
        cols.push("title");
        vals.push(Value::Text(title.clone()));
    }
    push(&mut cols, &mut vals, "project_id", &patch.project_id);
    push(&mut cols, &mut vals, "category_id", &patch.category_id);
    push(&mut cols, &mut vals, "owner_id", &patch.owner_id);
    push(&mut cols, &mut vals, "start_date", &patch.start_date);
    push(&mut cols, &mut vals, "note", &patch.note);
    if let Some(effort) = patch.effort_days {
        cols.push("effort_days");
        vals.push(Value::Real(effort));
    }
    if let Some(priority) = &patch.priority {
        cols.push("priority");
        vals.push(Value::Text(priority.clone()));
    }
    if let Some(exclusive) = patch.exclusive {
        cols.push("time_exclusive");
        vals.push(Value::Integer(exclusive as i64));
    }

    if let Some(tags) = &patch.tags {
        tx.execute("DELETE FROM task_tags WHERE task_id = ?1", [id])?;
        for name in tags {
            let name = name.trim();
            if name.is_empty() {
                continue;
            }
            let tag = crate::repo::tags::find_or_create(
                &tx,
                &uuid::Uuid::new_v4().to_string(),
                name,
                now,
            )?;
            tx.execute(
                "INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?1, ?2)",
                params![id, tag.id],
            )?;
        }
    }

    // A tags-only patch still counts as an edit, so archived lists re-sort on it.
    if cols.is_empty() && patch.tags.is_none() {
        return tx.commit();
    }
    cols.push("updated_at");
    vals.push(Value::Text(now.to_owned()));
    let set = cols
        .iter()
        .enumerate()
        .map(|(i, col)| format!("{col} = ?{}", i + 1))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!("UPDATE tasks SET {set} WHERE id = ?{}", cols.len() + 1);
    let mut args: Vec<&dyn rusqlite::ToSql> =
        vals.iter().map(|v| v as &dyn rusqlite::ToSql).collect();
    let id_param: &str = id;
    args.push(&id_param);
    tx.prepare_cached(&sql)?.execute(args.as_slice())?;
    tx.commit()
}

pub fn set_owner(conn: &Connection, id: &str, owner_id: &str, now: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE tasks SET owner_id = ?1, updated_at = ?2 WHERE id = ?3",
        params![owner_id, now, id],
    )?;
    Ok(())
}

pub fn list_project(conn: &Connection, project_id: &str) -> rusqlite::Result<Vec<TaskDto>> {
    let mut stmt = conn.prepare(
        "SELECT id FROM tasks
         WHERE project_id = ?1 AND deleted_at IS NULL AND canceled_at IS NULL AND archived_at IS NULL
         ORDER BY due_date IS NULL, due_date, created_at",
    )?;
    let ids: Vec<String> = stmt
        .query_map([project_id], |r| r.get(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    dtos(conn, &ids)
}
pub fn archive(conn: &Connection, id: &str, now: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE tasks SET archived_at = ?1, in_week = 0, updated_at = ?1 WHERE id = ?2",
        params![now, id],
    )?;
    Ok(())
}

pub fn restore(conn: &Connection, id: &str, now: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE tasks SET archived_at = NULL, canceled_at = NULL, in_week = 1,
              suspended = 0, suspended_until = NULL, suspended_at = NULL, suspend_reason = NULL,
              sort_order = (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM tasks),
              status = CASE WHEN status = 'done' THEN 'doing' ELSE status END,
              done_at = CASE WHEN status = 'done' THEN NULL ELSE done_at END,
              updated_at = ?1
         WHERE id = ?2",
        params![now, id],
    )?;
    Ok(())
}

pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM tasks WHERE id = ?1", [id])?;
    Ok(())
}

pub fn ordered_ids(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT id FROM tasks WHERE deleted_at IS NULL ORDER BY sort_order, id")?;
    let rows = stmt.query_map([], |r| r.get(0))?;
    rows.collect()
}

/// Renumbers every task in one transaction, so the order stays dense and tie-free.
pub fn write_orders(conn: &Connection, ids: &[String]) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    {
        let mut stmt = tx.prepare_cached("UPDATE tasks SET sort_order = ?1 WHERE id = ?2")?;
        for (index, id) in ids.iter().enumerate() {
            stmt.execute(params![index as i64, id])?;
        }
    }
    tx.commit()
}

fn list_where(
    conn: &Connection,
    condition: &str,
    query: Option<&str>,
) -> rusqlite::Result<Vec<ArchiveTaskDto>> {
    let pattern = query.map(crate::repo::like_pattern);
    let sql = format!(
        "SELECT id, title, archived_at, canceled_at FROM tasks
         WHERE deleted_at IS NULL AND {} AND {LIVE_PROJECT}
           AND (?1 IS NULL OR title LIKE ?1 ESCAPE '!')
         ORDER BY updated_at DESC",
        condition
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([pattern], |r| {
        Ok(ArchiveTaskDto {
            id: r.get(0)?,
            title: r.get(1)?,
            archived_at: r.get(2)?,
            canceled_at: r.get(3)?,
        })
    })?;
    rows.collect()
}

pub fn list_archived(conn: &Connection, query: Option<&str>) -> rusqlite::Result<Vec<ArchiveTaskDto>> {
    list_where(conn, "archived_at IS NOT NULL AND canceled_at IS NULL", query)
}

pub fn list_canceled(conn: &Connection, query: Option<&str>) -> rusqlite::Result<Vec<ArchiveTaskDto>> {
    list_where(conn, "canceled_at IS NOT NULL", query)
}
pub fn list_done(conn: &Connection, query: Option<&str>) -> rusqlite::Result<Vec<ArchiveTaskDto>> {
    list_where(
        conn,
        "status = 'done' AND canceled_at IS NULL AND archived_at IS NULL",
        query,
    )
}